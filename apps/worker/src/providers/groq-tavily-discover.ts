import { createHash } from 'node:crypto';
import type {
  CandidateLead,
  DiscoverContext,
  DiscoverProvider,
  JobSearchInput
} from '@lead/shared';
import { isAISearchRequest } from '@lead/shared';
import { tavily } from '@tavily/core';
import Groq from 'groq-sdk';
import type { Logger } from 'pino';
import { constructEmail, isJobPostingContent, isJobPostingUrl } from './tavily-discover.js';

// Mirrors the excluded domain list in tavily-discover — kept in sync manually
const EXCLUDED_DOMAINS = [
  'indeed.com',
  'glassdoor.com',
  'monster.com',
  'ziprecruiter.com',
  'careerbuilder.com',
  'simplyhired.com',
  'seek.com',
  'jobstreet.com',
  'jobsdb.com',
  'reed.co.uk',
  'totaljobs.com',
  'dice.com',
  'lever.co',
  'greenhouse.io',
  'myworkdayjobs.com',
  'workable.com',
  'smartrecruiters.com',
  'recruitee.com',
  'jobs.com',
  'themuse.com',
  'remoteok.com',
  'weworkremotely.com',
  'remotive.com',
  'remote.co',
  'remotifyeurope.com',
  'jobgether.com',
  'himalayas.app',
  'escapethecity.org',
  'nextleveljobs.eu',
  'efinancialcareers.com',
  'angel.co',
  'wellfound.com',
  'builtin.com',
  'datacaptive.com',
  'leadiq.com',
  'apollo.io',
  'rocketreach.co'
];

// Placeholder / fake domains the model tends to invent — never accept these
const JUNK_EMAIL_DOMAINS = new Set([
  'email.com',
  'example.com',
  'example.org',
  'example.net',
  'domain.com',
  'company.com',
  'companydomain.com',
  'yourcompany.com',
  'mycompany.com',
  'test.com',
  'acme.com',
  'none.com',
  'email.address',
  'website.com',
  'companyname.com',
  'business.com'
]);

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const GENERIC_LOCALPARTS = new Set([
  'info',
  'contact',
  'sales',
  'hello',
  'support',
  'enquiries',
  'enquiry',
  'hr',
  'careers',
  'admin',
  'office',
  'press',
  'media',
  'team',
  'help'
]);

type TavilyClient = ReturnType<typeof tavily>;

// 70b-versatile gives the best extraction quality. Free-tier limits: TPM 12000, TPD 100000.
// Override with GROQ_MODEL (e.g. 'llama-3.1-8b-instant' which has a much larger daily token budget)
// without a code change when the daily cap is hit.
const MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';

/** A real result we actually fetched from Tavily, keyed by normalized URL. */
interface StoredResult {
  url: string; // original, full URL (with scheme)
  title: string;
  content: string;
}

// Phase 1 — generate the web search queries as plain JSON (no tool-calling; the 8b model is
// unreliable at tool calls but follows JSON mode well).
const QUERY_PLAN_PROMPT = `You plan web searches to find the B2B leads the user describes.
Output a JSON object: {"queries": ["...", "..."]} with exactly 3 DIFFERENT, complementary search queries that find real people and contact emails across the whole web — company team/about pages, staff directories, press, speaker lists, professional profiles. Do NOT restrict to LinkedIn and do NOT append "linkedin" to every query. Vary the angle, e.g.:
- "<role>" "<company>" "<region>" email contact
- "<company> leadership team <region>"
- "<role> <company> <region>" news OR press OR directory
Output JSON only — no prose.`;

// Phase 2 — detailed extraction/grounding rules. Search results are inlined into the user message,
// so this call carries no tool-call history (keeps us under the 8b model's 6k tokens/min cap).
const SYNTHESIS_SYSTEM_PROMPT = `You convert web search results into a list of B2B leads. Output a JSON object of the form {"leads": [ ... ]}. Each element has exactly:
- name: the person's full name, OR the company name for an organisation-level mailbox (string)
- email: the contact email (string)
- title: their job title, or "Company Contact" for an organisation-level mailbox (string)
- company: their company name (string)
- sourceUrl: the exact result URL the contact was found on (string)

STRICT rules — a lead breaking any of these will be discarded:
1. RELEVANCE: Only include people whose role/seniority matches the user's request. Discard unrelated people (e.g. no recruiters/HR when the user asked for marketing leaders).
2. SOURCE — one distinct page per lead:
   - sourceUrl MUST be copied verbatim from one of the provided results. Never invent or edit a URL.
   - Each lead MUST use a DIFFERENT sourceUrl. NEVER assign the same URL to two different people.
   - Choose the URL of the page that is specifically ABOUT that person — their LinkedIn/profile page, their bio, their team page, or a press article that names them. The person's name should appear in that result's TITLE.
   - Do NOT use ranking lists, "top/best companies" listicles, directories, or any page that merely mentions many people or companies. If a person only appears inside such a list, skip them.
3. EMAIL — never fabricate:
   - Prefer an email that literally appears in the result content.
   - If a named person has no email shown, construct firstname.lastname@<the company's REAL website domain> (e.g. "Twilio" → twilio.com).
   - NEVER use placeholder domains like email.com, example.com, company.com, yourcompany.com.
   - A named person at a personal address (gmail.com, outlook.com) is valid — keep it.
   - A generic mailbox (info@, contact@, sales@, hr@, careers@) is valid as an organisation-level lead — set name = company and title = "Company Contact".
4. Emit one lead per distinct, person-specific source. Aim for as many strong, relevant leads as the results genuinely support (ideally 8-15). Use {"leads": []} only if nothing relevant was found. Output JSON only.`;

export class GroqTavilyDiscoverProvider implements DiscoverProvider {
  private readonly groq: Groq;
  private readonly tavilyClient: TavilyClient;
  private readonly logger: Logger;

  constructor(groqApiKey: string, tavilyApiKey: string, logger: Logger) {
    this.groq = new Groq({ apiKey: groqApiKey });
    this.tavilyClient = tavily({ apiKey: tavilyApiKey });
    this.logger = logger;
  }

  async discover(input: JobSearchInput, context: DiscoverContext): Promise<CandidateLead[]> {
    if (!isAISearchRequest(input)) return [];

    // Every real result we fetch, so we can validate the model's output against ground truth.
    const seenResults = new Map<string, StoredResult>();

    try {
      // ── Phase 1: plan search queries (plain JSON, no tool-calling) ──
      const planResponse = await this.groq.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: QUERY_PLAN_PROMPT },
          { role: 'user', content: input.naturalLanguageQuery }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0.3
      });

      const queries = parseQueries(planResponse.choices[0]?.message?.content ?? '').slice(0, 3);

      for (const query of queries) {
        try {
          this.logger.info({ jobId: context.jobId, query }, 'Groq calling tavily_search');
          const result = await this.tavilyClient.search(query, {
            searchDepth: 'advanced',
            maxResults: 6,
            excludeDomains: EXCLUDED_DOMAINS
          });
          for (const r of result.results) {
            const norm = normalizeUrl(r.url);
            if (!norm) continue;
            seenResults.set(norm, { url: r.url, title: r.title ?? '', content: r.content ?? '' });
          }
        } catch (error) {
          this.logger.warn({ error, jobId: context.jobId, query }, 'Tavily search failed');
        }
      }

      if (seenResults.size === 0) {
        this.logger.info({ jobId: context.jobId }, 'Groq AI search found no source pages');
        return [];
      }

      // ── Phase 2: forced JSON synthesis ── fresh, compact message (no tool history).
      // Inline a trimmed view of every result; the model maps them to grounded leads.
      const resultsForModel = [...seenResults.values()].map((r) => ({
        url: r.url,
        title: r.title,
        content: r.content.slice(0, 350)
      }));

      const final = await this.groq.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: SYNTHESIS_SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `User request: ${input.naturalLanguageQuery}\n\n` +
              `Search results (JSON):\n${JSON.stringify(resultsForModel)}\n\n` +
              'Return {"leads": [ ... ]} following all rules. JSON only.'
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 4096,
        temperature: 0.1
      });

      const raw = parseLeadsFromContent(final.choices[0]?.message?.content ?? '', context.jobId);
      const { leads, drops } = refineLeads(raw, seenResults);
      this.logger.info(
        {
          jobId: context.jobId,
          sources: seenResults.size,
          rawCount: raw.length,
          leadsFound: leads.length,
          drops
        },
        'Groq AI search completed'
      );
      return leads;
    } catch (error) {
      this.logger.error({ error, jobId: context.jobId }, 'Groq AI search failed');
    }

    return [];
  }
}

// ── URL helpers ────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  // Tolerate URLs the model echoed back without a scheme (e.g. "linkedin.com/in/foo").
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return '';
  }
}

// ── Validation / grounding layer ─────────────────────────────────────────────

type RefineResult = { ok: true; lead: CandidateLead } | { ok: false; reason: string };

function refineLeads(
  raw: CandidateLead[],
  seen: Map<string, StoredResult>
): { leads: CandidateLead[]; drops: Record<string, number> } {
  const out: CandidateLead[] = [];
  const seenEmails = new Set<string>();
  const seenSources = new Set<string>();
  const drops: Record<string, number> = {};
  const bump = (reason: string): void => {
    drops[reason] = (drops[reason] ?? 0) + 1;
  };

  for (const lead of raw) {
    const res = refineLead(lead, seen);
    if (!res.ok) {
      bump(res.reason);
      continue;
    }
    const refined = res.lead;

    const emailKey = refined.email.toLowerCase();
    if (seenEmails.has(emailKey)) {
      bump('dup-email');
      continue;
    }

    // One lead per distinct source page — mirrors the guided search and stops several leads
    // all pointing at the same website (e.g. a single listicle reused for many people).
    const urlKey = normalizeUrl(refined.sourceUrl);
    if (seenSources.has(urlKey)) {
      bump('dup-source');
      continue;
    }

    seenEmails.add(emailKey);
    seenSources.add(urlKey);
    out.push(refined);
  }

  return { leads: out.slice(0, 50), drops };
}

function refineLead(lead: CandidateLead, seen: Map<string, StoredResult>): RefineResult {
  const norm = normalizeUrl(lead.sourceUrl);
  if (!norm) return { ok: false, reason: 'bad-url' };

  // sourceUrl must be a page we actually fetched — kills invented/mismatched URLs
  const result = seen.get(norm);
  if (!result) return { ok: false, reason: 'url-not-fetched' };

  // Drop job postings (URL + the real, untruncated content)
  if (isJobPostingUrl(lead.sourceUrl)) return { ok: false, reason: 'job-url' };
  if (isJobPostingContent(result.title, result.content))
    return { ok: false, reason: 'job-content' };

  const local = (lead.email.split('@')[0] ?? '').toLowerCase();
  const isOrgContact = GENERIC_LOCALPARTS.has(local);

  // Anti-hallucination: a named individual must actually appear on the cited page.
  if (!isOrgContact) {
    const hay = `${result.title} ${result.content} ${lead.sourceUrl}`.toLowerCase();
    const lastName =
      lead.name
        .trim()
        .split(/\s+/)
        .pop()
        ?.toLowerCase()
        .replace(/[^a-zà-ÿ]/g, '') ?? '';
    if (lastName.length >= 3 && !hay.includes(lastName)) {
      return { ok: false, reason: 'name-absent' };
    }
  }

  // Drop listicles / rankings / "top N" pages — the source should be about the contact,
  // not a page that merely lists many people or companies (the "wrong website" problem).
  if (isListicleSource(result.title, lead.sourceUrl)) {
    return { ok: false, reason: 'listicle' };
  }

  const email = resolveEmail(lead, result);
  if (!email) return { ok: false, reason: 'no-email' };

  return {
    ok: true,
    lead: {
      providerCandidateKey: lead.providerCandidateKey,
      name: (isOrgContact ? lead.company : lead.name).slice(0, 120) || lead.company.slice(0, 120),
      email,
      title: (isOrgContact ? 'Company Contact' : lead.title || 'Professional').slice(0, 120),
      company: (lead.company || 'Unknown').slice(0, 120),
      sourceUrl: result.url // canonical full URL from the fetched result, not the model's echo
    }
  };
}

// Ranking/listicle aggregator hosts — pages here list many companies/people, never a single contact
const LISTICLE_HOSTS = new Set([
  'getlatka.com',
  'growjo.com',
  'failory.com',
  'clutch.co',
  'g2.com',
  'capterra.com',
  'owler.com',
  'similarweb.com',
  'tracxn.com',
  'cbinsights.com',
  'producthunt.com',
  'softwareworld.co',
  'goodfirms.co'
]);

const LISTICLE_TITLE_PATTERNS = [
  /\btop\s+\d+/i, // "top 10"
  /\b\d+\s+(best|top|leading|biggest|largest|fastest|most)\b/i, // "20 best"
  /\b(best|top|leading)\b[\w\s,&-]*\b(companies|startups|firms|agencies|brands|employers|vendors|tools)\b/i,
  /\b(list|listing|ranking|rankings|directory)\b/i,
  /\bcompanies (in|to watch|to know)\b/i
];

/**
 * True when the source is a ranking/listicle/directory that merely lists many entities — the
 * "wrong website" case. The contact's real page (profile, bio, press piece) is not one of these.
 */
function isListicleSource(title: string, url: string): boolean {
  if (LISTICLE_TITLE_PATTERNS.some((re) => re.test(title))) return true;
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host.replace(
      /^www\./,
      ''
    );
    if (LISTICLE_HOSTS.has(host)) return true;
  } catch {
    // ignore
  }
  return false;
}

/** Returns a trustworthy email or null. Prefers a real email on the page; never returns a junk domain. */
function resolveEmail(lead: CandidateLead, result: StoredResult): string | null {
  const candidate = lead.email.trim().toLowerCase();
  const candidateDomain = candidate.split('@')[1] ?? '';

  // 1. The model's email is fine if it's well-formed, not a placeholder domain, and has a
  //    plausible local-part (not a single stray letter like "s@gmail.com")
  if (
    isValidEmail(candidate) &&
    !JUNK_EMAIL_DOMAINS.has(candidateDomain) &&
    isPlausibleLocalPart(candidate.split('@')[0] ?? '')
  ) {
    return candidate;
  }

  // 2. Otherwise, try to recover a real email straight from the page content
  const realEmail = findRealEmail(result.content);
  if (realEmail) return realEmail;

  // 3. Last resort: construct from the person's name + the company's real domain
  const constructed = constructEmail(lead.name, lead.company)?.toLowerCase();
  if (constructed && isValidEmail(constructed)) {
    const domain = constructed.split('@')[1] ?? '';
    if (!JUNK_EMAIL_DOMAINS.has(domain)) return constructed;
  }

  return null;
}

function findRealEmail(content: string): string | null {
  const matches = content.match(EMAIL_RE) ?? [];
  for (const m of matches) {
    const email = m.toLowerCase();
    const domain = email.split('@')[1] ?? '';
    if (JUNK_EMAIL_DOMAINS.has(domain)) continue;
    // skip obvious asset/sentry noise
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/.test(email)) continue;
    if (/(sentry|wixpress|example)\./.test(domain)) continue;
    return email;
  }
  return null;
}

// Rejects nonsense local-parts like "s" or "a" — a real person mailbox has at least 2 chars.
function isPlausibleLocalPart(local: string): boolean {
  return local.length >= 2 && /[a-z]/.test(local);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Pull a list of query strings out of the planner's {"queries":[...]} JSON. */
function parseQueries(content: string): string[] {
  try {
    const parsed = JSON.parse(content.trim());
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? ((parsed as Record<string, unknown>).queries ??
          Object.values(parsed as Record<string, unknown>).find((v) => Array.isArray(v)))
        : null;
    if (!Array.isArray(arr)) return [];
    return arr.map((q) => String(q).trim()).filter((q) => q.length > 0);
  } catch {
    return [];
  }
}

/** Accepts a bare array, a {"leads":[...]} object, or any object with an array property. */
function extractLeadArray(content: string): unknown[] | null {
  const trimmed = content.trim();

  // Try parsing the whole thing first (response_format json_object returns clean JSON)
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.leads)) return obj.leads;
      const firstArray = Object.values(obj).find((v) => Array.isArray(v));
      if (firstArray) return firstArray as unknown[];
    }
  } catch {
    // fall through to regex extraction
  }

  // Fallback: pull the first JSON array out of surrounding prose
  const match = trimmed.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) return arr;
    } catch {
      // ignore
    }
  }
  return null;
}

function parseLeadsFromContent(content: string, jobId: string): CandidateLead[] {
  const raw = extractLeadArray(content);
  if (!raw) return [];

  const candidates: CandidateLead[] = [];
  for (const [index, item] of raw.entries()) {
    if (typeof item !== 'object' || item === null) continue;
    const lead = item as Record<string, unknown>;

    const name = String(lead.name ?? '').trim();
    const email = String(lead.email ?? '').trim();
    const title = String(lead.title ?? '').trim();
    const company = String(lead.company ?? '').trim();
    const sourceUrl = String(lead.sourceUrl ?? lead.source_url ?? '').trim();

    if (!name || !email || !email.includes('@') || !email.includes('.')) continue;
    if (!sourceUrl) continue;

    const key = `groq:${createHash('sha256')
      .update(`${jobId}:${email}:${index}`)
      .digest('hex')
      .slice(0, 24)}`;

    candidates.push({
      providerCandidateKey: key,
      name: name.slice(0, 120),
      email,
      title: (title || 'Professional').slice(0, 120),
      company: (company || 'Unknown').slice(0, 120),
      sourceUrl
    });
  }

  return candidates.slice(0, 50);
}
