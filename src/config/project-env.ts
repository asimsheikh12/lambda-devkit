import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export type ProjectEnvRule = {
  /** All keys must match process.env (e.g. { sslOn: 'true' }). */
  when: Record<string, string>;
  /** Keys to set when the rule matches. */
  set: Record<string, string>;
};

export type LoadProjectEnvOptions = {
  /** Paths relative to `cwd` (default process.cwd()). Later files override earlier ones. */
  files?: string[];
  /** When true, do not load `./.env` in the project directory (see loadRawConfig). */
  skipDotenv?: boolean;
  /** Copy `from` → `to` when `from` is set and `to` is not. */
  aliases?: Record<string, string>;
  /** Conditional env assignments (e.g. sslOn → DB_SSL). */
  rules?: ProjectEnvRule[];
  /**
   * When AWS access key looks like a real IAM user (`AKIA*`), remove custom
   * `AWS_ENDPOINT_URL*` overrides so the SDK uses production AWS endpoints.
   */
  stripCustomEndpointForRealAws?: boolean;
  cwd?: string;
};

function parseEnvLines(content: string, override: boolean): void {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const hashIndex = trimmed.indexOf(' #');
    const lineBody = hashIndex >= 0 ? trimmed.slice(0, hashIndex).trim() : trimmed;
    const eqIndex = lineBody.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = lineBody.slice(0, eqIndex).trim();
    let value = lineBody.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (override || !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function loadEnvFileAt(filePath: string, options?: { override?: boolean }): void {
  if (!existsSync(filePath)) {
    return;
  }

  parseEnvLines(readFileSync(filePath, 'utf8'), options?.override ?? false);
}

export function applyEnvAliases(aliases: Record<string, string> | undefined): void {
  if (!aliases) {
    return;
  }

  for (const [from, to] of Object.entries(aliases)) {
    const value = process.env[from];
    if (value !== undefined && value !== '' && !(to in process.env)) {
      process.env[to] = value;
    }
  }
}

export function applyEnvRules(rules: ProjectEnvRule[] | undefined): void {
  if (!rules?.length) {
    return;
  }

  for (const rule of rules) {
    const matches = Object.entries(rule.when).every(
      ([key, expected]) => process.env[key] === expected,
    );
    if (!matches) {
      continue;
    }

    for (const [key, value] of Object.entries(rule.set)) {
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

export function stripCustomAwsEndpointsIfRealCredentials(): void {
  if (!process.env.AWS_ACCESS_KEY_ID?.startsWith('AKIA')) {
    return;
  }

  for (const key of Object.keys(process.env)) {
    if (key === 'AWS_ENDPOINT_URL' || key.startsWith('AWS_ENDPOINT_URL_')) {
      delete process.env[key];
    }
  }
}

/**
 * Load project env files and normalize names — call at the top of `lamkit.config.*`
 * before reading `process.env` in the config object.
 */
export function loadProjectEnv(options: LoadProjectEnvOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const files = options.files ?? [];

  for (const file of files) {
    const resolved = isAbsolute(file) ? file : resolve(cwd, file);
    loadEnvFileAt(resolved, { override: true });
  }

  applyEnvAliases(options.aliases);
  applyEnvRules(options.rules);

  if (options.stripCustomEndpointForRealAws !== false) {
    stripCustomAwsEndpointsIfRealCredentials();
  }

  if (options.skipDotenv) {
    process.env.LAMKIT_ENV_LOADED = '1';
    process.env.LAMKIT_SKIP_DOTENV = '1';
  }
}
