import { createHash } from 'node:crypto';
import type { CandidateLead, DiscoverContext, DiscoverProvider, JobSearchInput } from '@lead/shared';
import { isGuidedSearchRequest } from '@lead/shared';
import { tavily } from '@tavily/core';
import type { Logger } from 'pino';

type TavilyClient = ReturnType<typeof tavily>;

// Excluded at the Tavily API level — results never come back from these domains
const EXCLUDED_DOMAINS = [
  // Major global job boards
  'indeed.com', 'glassdoor.com', 'monster.com', 'ziprecruiter.com',
  'careerbuilder.com', 'simplyhired.com', 'seek.com', 'jobstreet.com',
  'jobsdb.com', 'reed.co.uk', 'totaljobs.com', 'dice.com',
  // ATS / recruiting platforms
  'lever.co', 'greenhouse.io', 'myworkdayjobs.com', 'workable.com',
  'smartrecruiters.com', 'recruitee.com', 'jobs.com', 'themuse.com',
  // Remote job boards
  'remoteok.com', 'weworkremotely.com', 'remotive.com', 'remote.co',
  'remotifyeurope.com', 'jobgether.com', 'himalayas.app',
  // Niche boards
  'escapethecity.org', 'nextleveljobs.eu', 'efinancialcareers.com',
  'cwjobs.co.uk', 'technojobs.co.uk', 'angel.co', 'wellfound.com',
  'builtin.com', 'builtinnyc.com', 'builtinboston.com', 'builtinla.com',
  // Data brokers / email list vendors (not person profiles)
  'datacaptive.com', 'leadiq.com', 'apollo.io', 'rocketreach.co',
  'lusha.com', 'cognism.com', 'datanyze.com',
];

// URL path patterns — catches job listings on unlisted domains (e.g. linkedin.com/jobs, remote-jobs/)
const JOB_URL_PATH_PATTERNS = [
  'linkedin.com/jobs',
  'linkedin.com/job-search',
  'linkedin.com/pulse',     // LinkedIn articles (career/hiring opinion pieces)
  '/jobs/',
  '/job/',
  '-jobs/',                 // remote-jobs/, tech-jobs/, etc.
  '-job/',
  '/careers/',
  '/career/',
  '/vacancies/',
  '/vacancy/',
  '/hiring/',
  '/openings/',
  '/job-openings/',
  '/apply/',
  '/positions/',
  '/position/',
  '/talent/',
  '/recruitment/',
  '/work-with-us',
  '/join-our-team',
  '/join-us',
  'were-hiring',
  'we-re-hiring',
  'now-hiring',
];

// Content signals — catches job postings whose URL looks clean
const JOB_CONTENT_PATTERNS = [
  /\b(job description|job posting|job summary|job requirements)\b/i,
  /\b(we (are|'re) (looking for|hiring|seeking)|now hiring|currently hiring)\b/i,
  /\b(apply (now|here|today|online)|click to apply|how to apply)\b/i,
  /\b(submit (your )?(resume|cv|application)|send (your )?(cv|resume))\b/i,
  /\b(equal opportunity employer|eoe\b|eeoc)\b/i,
  /\b(salary range|base salary|competitive salary|compensation package)\b/i,
  /\b(responsibilities?:\s|qualifications?:\s|requirements?:\s|what you.ll do)\b/i,
  /\b(years? of experience|minimum (of )?[0-9]+ years?)\b/i,
  /\b(join our (growing |dynamic |amazing )?team)\b/i,
];

export function isJobPostingUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (JOB_URL_PATH_PATTERNS.some((p) => lower.includes(p))) return true;
  // Hostname-level check: domains with job/recruit/talent/career/hire in the name
  try {
    const hostname = new URL(lower).hostname.replace(/^www\./, '');
    if (/\b(job|recruit|career|talent|hire|staffing|vacancy)\b/.test(hostname)) return true;
  } catch {
    // ignore invalid URLs
  }
  return false;
}

export function isJobPostingContent(title: string, content: string): boolean {
  const text = `${title} ${content}`;
  return JOB_CONTENT_PATTERNS.some((p) => p.test(text));
}

export class TavilyDiscoverProvider implements DiscoverProvider {
  private readonly client: TavilyClient;
  private readonly logger: Logger;

  constructor(apiKey: string, logger: Logger) {
    this.client = tavily({ apiKey });
    this.logger = logger;
  }

  async discover(input: JobSearchInput, _context: DiscoverContext): Promise<CandidateLead[]> {
    if (!isGuidedSearchRequest(input)) return [];

    const candidates: CandidateLead[] = [];
    const seenKeys = new Set<string>();

    const companies = input.companiesOrKeywords.slice(0, 3);
    const roles = input.roles.slice(0, 2);

    for (const company of companies) {
      for (const role of roles) {
        const query = `"${role}" "${company}" "${input.region}" email contact`;
        try {
          const response = await this.client.search(query, {
            searchDepth: 'advanced',
            maxResults: 8,
            excludeDomains: EXCLUDED_DOMAINS
          });

          for (const result of response.results) {
            if (isJobPostingUrl(result.url)) continue;
            if (isJobPostingContent(result.title, result.content)) continue;

            const key = `tavily:${createHash('sha256').update(result.url).digest('hex').slice(0, 24)}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);

            const lead = extractLead(result, company, role, key);
            if (lead) candidates.push(lead);
          }
        } catch (error) {
          this.logger.warn({ error, company, role }, 'Tavily search failed for query — skipping');
        }
      }
    }

    return candidates.slice(0, 50);
  }
}

// Titles that are clearly not person profiles — skip even if regex matches words
const NON_PERSON_TITLE_PATTERNS = [
  /^(how|what|why|when|where|who)\b/i,
  /\b(phone number|customer service|global offices?|contact us|about us)\b/i,
  /\b(headquarters|locations?|offices?|careers?|job listing)\b/i,
  /\b(faq|frequently asked|help center|support center)\b/i,
  /\bjobs?\b/i,
  /\b(hiring|recruitment|staffing)\b/i,
  /\b(email list|user list|company list|company overview)\b/i,
];

function isNonPersonTitle(title: string): boolean {
  return NON_PERSON_TITLE_PATTERNS.some((p) => p.test(title));
}

// Words that should never appear at the start of a real person name
const NON_NAME_START_WORDS = new Set([
  'remote', 'senior', 'junior', 'lead', 'staff', 'principal', 'associate',
  'is', 'this', 'the', 'our', 'all', 'how', 'what', 'why',
  'popular', 'contact', 'support', 'global', 'company', 'traveling',
  'top', 'best', 'about', 'press', 'news', 'blog', 'join', 'home',
  'overview', 'general', 'new', 'old', 'free', 'official', 'find', 'get',
  'meet', 'team', 'people', 'hiring', 'apply', 'job', 'jobs',
  'manager', 'director', 'vp', 'engineer', 'developer', 'analyst',
  'consultant', 'account', 'sales', 'marketing', 'product', 'software',
  'data', 'head', 'chief', 'vice', 'executive', 'specialist',
]);

function extractLead(
  result: { title: string; url: string; content: string },
  company: string,
  role: string,
  key: string
): CandidateLead | null {
  if (isNonPersonTitle(result.title)) return null;

  const explicitEmail = result.content.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
  )?.[0];

  const name = extractPersonName(result.title, result.url);

  if (!name) {
    // No person name found — if there's an explicit email on the page (e.g. info@, contact@)
    // keep it under the company name so it shows up as a rejected lead in the inbox.
    if (!explicitEmail) return null;
    return {
      providerCandidateKey: key,
      name: company.slice(0, 120),
      company: company.slice(0, 120),
      title: role.slice(0, 120),
      email: explicitEmail,
      sourceUrl: result.url
    };
  }

  const email = explicitEmail ?? constructEmail(name, company);
  if (!email) return null;

  return {
    providerCandidateKey: key,
    name: name.slice(0, 120),
    company: company.slice(0, 120),
    title: role.slice(0, 120),
    email,
    sourceUrl: result.url
  };
}

function extractPersonName(title: string, url: string): string | null {
  if (url.includes('linkedin.com/in/')) {
    const candidate = title.split(' - ')[0]?.trim();
    if (candidate && /^[A-Z][a-zÀ-ÿ'-]+(?: [A-Z][a-zÀ-ÿ'-]+)+$/.test(candidate)) {
      return candidate;
    }
  }
  const nameMatch = title.match(/^([A-Z][a-zÀ-ÿ'-]+(?:\s+[A-Z][a-zÀ-ÿ'-]+)+)/);
  if (!nameMatch) return null;
  const firstWord = nameMatch[1]!.split(' ')[0]!.toLowerCase();
  if (NON_NAME_START_WORDS.has(firstWord)) return null;
  return nameMatch[1] ?? null;
}

export function constructEmail(name: string, company: string): string | null {
  const parts = name.toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0]!.replace(/[^a-z]/g, '');
  const last = parts[parts.length - 1]!.replace(/[^a-z]/g, '');
  if (!first || !last) return null;
  return `${first}.${last}@${inferDomain(company)}`;
}

export function inferDomain(company: string): string {
  const brand =
    company
      .toLowerCase()
      .replace(/\b(international|hotels|resorts|group|inc|ltd|llc|corporation|corp|co|the|and|&)\b/gi, ' ')
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)[0] ?? 'company';
  return `${brand}.com`;
}
