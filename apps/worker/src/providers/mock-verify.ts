import { createHash } from 'node:crypto';
import type { CandidateLead, VerificationResult, VerifyProvider } from '@lead/shared';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NOREPLY_PREFIXES = ['noreply', 'no-reply', 'no_reply'];

const GENERIC_INFO_PREFIXES = [
  'info', 'contact', 'enquiries', 'enquiry',
  'hello', 'hi', 'hey', 'support', 'helpdesk',
];

const DEPARTMENT_PREFIXES = [
  'hr', 'admin', 'careers', 'recruitment', 'jobs',
  'sales', 'marketing', 'legal', 'finance', 'billing', 'accounts',
  'office', 'reception', 'team',
  'press', 'media', 'pr', 'privacy', 'security', 'abuse',
];

function deterministicScore(email: string): number {
  const byte = createHash('sha256').update(email.toLowerCase()).digest()[0]!;
  return 50 + (byte % 51); // 50–100 for approved leads (0–49 reserved for rejections)
}

export class MockVerifyProvider implements VerifyProvider {
  constructor(private readonly delayMs: number = 0) {}

  async verify(candidate: CandidateLead): Promise<VerificationResult> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    const email = candidate.email.trim().toLowerCase();

    if (!emailPattern.test(email)) {
      return { ok: false, score: 0, reason: 'Email address is syntactically invalid.' };
    }

    const atIndex = email.indexOf('@');
    const local = email.slice(0, atIndex);

    // Personal email domains (gmail, outlook, etc.) are accepted — a named person reachable at a
    // personal address is still a valid lead. Only non-person mailboxes are rejected below.

    const matchesPrefix = (list: string[]) =>
      list.some(
        (prefix) =>
          local === prefix ||
          local.startsWith(prefix + '.') ||
          local.startsWith(prefix + '_') ||
          local.startsWith(prefix + '-')
      );

    if (matchesPrefix(NOREPLY_PREFIXES)) {
      return { ok: false, score: 12, reason: 'No-reply address — responses cannot be received here.' };
    }
    if (matchesPrefix(GENERIC_INFO_PREFIXES)) {
      return { ok: false, score: 12, reason: 'Generic info mailbox — not a person-level contact.' };
    }
    if (matchesPrefix(DEPARTMENT_PREFIXES)) {
      return { ok: false, score: 12, reason: 'Departmental mailbox is not a person-level lead.' };
    }

    return { ok: true, score: deterministicScore(email) };
  }
}
