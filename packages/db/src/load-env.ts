import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

/**
 * Loads the nearest `.env` by walking up from the current working directory to
 * the filesystem root. npm workspace scripts run with the package directory as
 * cwd, so a plain `dotenv/config` (which only reads `./.env`) would miss the
 * monorepo-root `.env`. Walking up finds the single root `.env` from any
 * workspace, and is a no-op in Docker where variables come from the environment.
 */
export function loadRootEnv(): void {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return; // reached filesystem root, nothing to load
    dir = parent;
  }
}
