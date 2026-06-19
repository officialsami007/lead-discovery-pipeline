import { z } from 'zod';

const envSchema = z.object({
  // Defaults to the local Docker/Postgres used in development so the app runs
  // with no .env. Production (Render/compose) always provides DATABASE_URL.
  DATABASE_URL: z
    .string()
    .url()
    .default('postgres://postgres:postgres@localhost:5432/lead_pipeline')
});

export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return envSchema.parse(env).DATABASE_URL;
}
