import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url()
});

export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return envSchema.parse(env).DATABASE_URL;
}
