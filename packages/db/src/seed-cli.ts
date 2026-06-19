import { createDatabaseClient } from './client.js';
import { databaseUrlFromEnv } from './env.js';
import { loadRootEnv } from './load-env.js';
import { seedDemoData } from './seed.js';

loadRootEnv();

const client = createDatabaseClient(databaseUrlFromEnv());
try {
  await seedDemoData(client.db);
  console.log('Demo data seeded.');
} finally {
  await client.close();
}
