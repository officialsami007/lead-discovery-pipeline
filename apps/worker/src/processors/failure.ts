import { searchJobs } from '@lead/db';
import type { Database } from '@lead/db';
import type { QueueJobPayload } from '@lead/shared';
import { and, eq, inArray } from 'drizzle-orm';

export async function markJobFailed(
  db: Database,
  payload: QueueJobPayload,
  safeMessage: string
): Promise<void> {
  await db
    .update(searchJobs)
    .set({
      status: 'failed',
      errorMessage: safeMessage,
      completedAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(searchJobs.id, payload.jobId),
        eq(searchJobs.organizationId, payload.organizationId),
        inArray(searchJobs.status, ['queued', 'discovering', 'verifying'])
      )
    );
}
