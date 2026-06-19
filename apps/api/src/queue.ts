import { QUEUE_NAMES, type QueueJobPayload } from '@lead/shared';
import PgBoss from 'pg-boss';
import type { QueuePublisher } from './types.js';

export async function createQueuePublisher(connectionString: string): Promise<QueuePublisher> {
  const boss = new PgBoss(connectionString);
  await boss.start();
  await boss.createQueue(QUEUE_NAMES.discover);
  await boss.createQueue(QUEUE_NAMES.verify);

  return {
    async publishDiscovery(payload: QueueJobPayload): Promise<void> {
      await boss.send(QUEUE_NAMES.discover, payload, {
        retryLimit: 2,
        retryDelay: 2,
        retryBackoff: true,
        singletonKey: `discover:${payload.jobId}`,
        expireInSeconds: 120
      });
    },
    async close(): Promise<void> {
      await boss.stop({ graceful: true, timeout: 10_000 });
    }
  };
}
