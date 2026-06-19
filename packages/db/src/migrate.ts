import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabaseClient } from './client.js';
import { databaseUrlFromEnv } from './env.js';
import { loadRootEnv } from './load-env.js';

loadRootEnv();

const client = createDatabaseClient(databaseUrlFromEnv());
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations'
);

try {
  await migrate(client.db, { migrationsFolder });
  console.log('Database migrations completed.');
} finally {
  await client.close();
}
