import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const adminUrl =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const databaseName = `lead_pipeline_test_${randomBytes(6).toString('hex')}`;

async function canConnect() {
  const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensurePostgres() {
  if (await canConnect()) return;
  const docker = spawnSync('docker', ['--version'], { stdio: 'ignore' });
  if (docker.status === 0) {
    console.log('Starting the Docker Compose PostgreSQL service for tests...');
    execFileSync('docker', ['compose', 'up', '-d', 'db'], { stdio: 'inherit' });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (await canConnect()) return;
    }
  }
  throw new Error(
    `PostgreSQL is not reachable at ${adminUrl}. Start it with "docker compose up -d db" or set TEST_DATABASE_ADMIN_URL.`
  );
}

await ensurePostgres();
const admin = new Client({ connectionString: adminUrl });
await admin.connect();

const testUrl = new URL(adminUrl);
testUrl.pathname = `/${databaseName}`;

try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const environment = {
    ...process.env,
    DATABASE_URL: testUrl.toString(),
    TEST_DATABASE_URL: testUrl.toString(),
    NODE_ENV: 'test',
    COOKIE_SECRET: 'test-cookie-secret-that-is-at-least-thirty-two-chars'
  };
  execFileSync('npm', ['run', 'db:migrate'], { stdio: 'inherit', env: environment });
  const vitestEntry = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
  execFileSync(process.execPath, [vitestEntry, 'run', '--config', 'vitest.config.ts'], {
    stdio: 'inherit',
    env: environment
  });
} finally {
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [databaseName]
  );
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
}
