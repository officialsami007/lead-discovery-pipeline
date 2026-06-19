import { createHash } from 'node:crypto';
import type {
  CandidateLead,
  DiscoverContext,
  DiscoverProvider,
  JobSearchInput
} from '@lead/shared';
import { isGuidedSearchRequest } from '@lead/shared';

const firstNames = ['Aisha', 'Daniel', 'Farah', 'Marcus', 'Priya', 'Noor', 'Hannah', 'Kenji'];
const lastNames = ['Rahman', 'Tan', 'Aziz', 'Lim', 'Nair', 'Lee', 'Wong', 'Kumar'];
const companySuffixes = ['Hotels', 'Hospitality', 'Resorts', 'Group', 'International'];

function digest(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'candidate'
  );
}

export class MockDiscoverProvider implements DiscoverProvider {
  async discover(input: JobSearchInput, context: DiscoverContext): Promise<CandidateLead[]> {
    if (!isGuidedSearchRequest(input)) {
      return this.mockAiResults(input.naturalLanguageQuery, context.jobId);
    }
    const normalized = JSON.stringify(input);
    if (input.companiesOrKeywords.some((value) => value.toLowerCase() === 'zero-results')) {
      return [];
    }

    const marriottDemo =
      input.companiesOrKeywords.some((value) => value.toLowerCase().includes('marriott')) &&
      input.roles.some((value) => value.toLowerCase().includes('director of sales')) &&
      input.region.toLowerCase().includes('malaysia');

    const count = marriottDemo ? 6 : digest(`${context.jobId}:${normalized}`)[0]! % 51;
    const candidates: CandidateLead[] = [];

    for (let index = 0; index < count; index += 1) {
      const bytes = digest(`${context.jobId}:${normalized}:${index}`);
      const first = firstNames[bytes[0]! % firstNames.length]!;
      const last = lastNames[bytes[1]! % lastNames.length]!;
      const baseCompany = input.companiesOrKeywords[index % input.companiesOrKeywords.length]!;
      const company =
        marriottDemo && index < 3
          ? ['Marriott International', 'The Westin Kuala Lumpur', 'Renaissance Kuala Lumpur'][
              index
            ]!
          : `${baseCompany} ${companySuffixes[bytes[2]! % companySuffixes.length]!}`;
      const title = input.roles[index % input.roles.length]!;
      const domain = `${slug(company)}.example.com`;
      // Every 3rd result is a generic/no-reply mailbox (no specific person) — the verifier rejects
      // these as non-person contacts. All others are person-level business emails that verify.
      const genericPrefixes = ['info', 'contact', 'sales', 'noreply'];
      const email =
        index % 3 === 2
          ? `${genericPrefixes[((index / 3) % genericPrefixes.length) | 0]!}@${domain}`
          : `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`;

      candidates.push({
        providerCandidateKey: `mock:${digest(`${normalized}:${index}`).toString('hex').slice(0, 24)}`,
        name: `${first} ${last}`,
        company,
        title,
        email,
        sourceUrl: `https://directory.example.com/${slug(company)}/${slug(`${first}-${last}`)}`
      });
    }

    return candidates;
  }

  private mockAiResults(query: string, jobId: string): CandidateLead[] {
    const bytes = digest(`${jobId}:${query}`);
    return [
      {
        providerCandidateKey: `mock-ai:${digest(`${jobId}:0`).toString('hex').slice(0, 24)}`,
        name: `${firstNames[bytes[0]! % firstNames.length]!} ${lastNames[bytes[1]! % lastNames.length]!}`,
        company: 'Acme Corp (Mock AI Result)',
        title: 'Head of Growth',
        email: `${firstNames[bytes[0]! % firstNames.length]!.toLowerCase()}.${lastNames[bytes[1]! % lastNames.length]!.toLowerCase()}@acme-mock.example.com`,
        sourceUrl: 'https://directory.example.com/mock-ai/1'
      },
      {
        providerCandidateKey: `mock-ai:${digest(`${jobId}:1`).toString('hex').slice(0, 24)}`,
        name: `${firstNames[bytes[2]! % firstNames.length]!} ${lastNames[bytes[3]! % lastNames.length]!}`,
        company: 'GlobalTech (Mock AI Result)',
        title: 'VP Sales',
        email: `${firstNames[bytes[2]! % firstNames.length]!.toLowerCase()}.${lastNames[bytes[3]! % lastNames.length]!.toLowerCase()}@globaltech-mock.example.com`,
        sourceUrl: 'https://directory.example.com/mock-ai/2'
      }
    ];
  }
}
