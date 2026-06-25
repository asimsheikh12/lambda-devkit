import { join } from 'node:path';
import { loadEnvFileAt } from './project-env.js';

const ENV_FILE = '.env';

/**
 * Minimal KEY=value parser (no dotenv dependency).
 * Supports optional single/double quotes and # comments.
 */
export function loadEnvFile(cwd: string = process.cwd()): void {
  if (process.env.LAMKIT_SKIP_DOTENV === '1') {
    return;
  }

  const envPath = join(cwd, ENV_FILE);
  loadEnvFileAt(envPath, { override: false });
}

export { loadEnvFileAt, loadProjectEnv, applyEnvAliases, applyEnvRules } from './project-env.js';
export type { LoadProjectEnvOptions, ProjectEnvRule } from './project-env.js';
