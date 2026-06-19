import 'dotenv/config';
import { createDatabaseClient } from './client.js';
import { databaseUrlFromEnv } from './env.js';
import { seedDemoData } from './seed.js';

const client = createDatabaseClient(databaseUrlFromEnv());
try {
  await seedDemoData(client.db);
  console.log('Demo data seeded.');
} finally {
  await client.close();
}
