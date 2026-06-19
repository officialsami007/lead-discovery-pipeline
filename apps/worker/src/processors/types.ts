import type { Database } from '@lead/db';
import type { DiscoverProvider, QueueJobPayload, VerifyProvider } from '@lead/shared';
import type { Logger } from 'pino';

export interface ProcessorDependencies {
  db: Database;
  discoverProvider: DiscoverProvider;
  verifyProvider: VerifyProvider;
  enqueueVerify: (payload: QueueJobPayload) => Promise<void>;
  logger: Logger;
  crashAfterDiscoverCommit?: boolean;
}
