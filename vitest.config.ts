import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@lead/shared': path.resolve(root, 'packages/shared/src/index.ts'),
      '@lead/db': path.resolve(root, 'packages/db/src/index.ts'),
      '@lead/api': path.resolve(root, 'apps/api/src/index.ts'),
      '@lead/worker': path.resolve(root, 'apps/worker/src/index.ts')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: { reporter: ['text', 'html'] }
  }
});
