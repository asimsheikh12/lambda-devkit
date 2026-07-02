import { existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MissingPeerError } from '../peer-resolve.js';
import { ensureTsxRegistered } from '../util/tsx-register.js';
import { loadEnvFile } from './env.js';
import { mergeConfig, type MergedConfig } from './merge.js';
import { formatZodError, parseConfig, type LamkitConfig } from './schema.js';
import { ensureAssetLinks } from '../runtime/asset-links.js';
import { ZodError } from 'zod';

const CONFIG_CANDIDATES = [
  'lamkit.config.ts',
  'lamkit.config.js',
  'lamkit.config.mjs',
  'lamkit.config.cjs',
] as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type LoadConfigOptions = {
  /** Bypass in-memory config cache and re-import the config module. */
  reload?: boolean;
};

const mergedConfigCache = new Map<string, { mtimeMs: number; config: MergedConfig }>();

export function clearConfigCache(): void {
  mergedConfigCache.clear();
}

export function findConfigPath(cwd: string = process.cwd()): string | null {
  for (const filename of CONFIG_CANDIDATES) {
    const fullPath = join(cwd, filename);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

async function importConfigModule(
  configPath: string,
  cwd: string,
  cacheBust: string,
): Promise<unknown> {
  if (extname(configPath) === '.ts') {
    try {
      await ensureTsxRegistered(cwd, 'lamkit.config.ts');
    } catch (error) {
      if (error instanceof MissingPeerError) {
        throw new ConfigError(error.message);
      }
      throw error;
    }
  }

  const moduleUrl = `${pathToFileURL(configPath).href}${cacheBust}`;
  const imported = (await import(moduleUrl)) as { default?: LamkitConfig } & LamkitConfig;
  return imported.default ?? imported;
}

export async function loadRawConfig(
  cwd: string = process.cwd(),
  options?: { configPath?: string; mtimeMs?: number; reload?: boolean },
): Promise<LamkitConfig> {
  const configPath = options?.configPath ?? findConfigPath(cwd);
  if (!configPath) {
    throw new ConfigError(
      `No config file found in ${cwd}. Expected one of: ${CONFIG_CANDIDATES.join(', ')}`,
    );
  }

  const mtimeMs = options?.mtimeMs ?? statSync(configPath).mtimeMs;
  const cacheBust = options?.reload ? `?t=${Date.now()}` : `?v=${mtimeMs}`;

  try {
    const raw = await importConfigModule(configPath, cwd, cacheBust);

    if (process.env.LAMKIT_ENV_LOADED !== '1') {
      loadEnvFile(cwd);
    }

    return parseConfig(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ConfigError(`Invalid lamkit config:\n${formatZodError(error)}`);
    }
    throw error;
  }
}

export async function loadConfig(
  cwd: string = process.cwd(),
  options?: LoadConfigOptions,
): Promise<MergedConfig> {
  if (options?.reload) {
    mergedConfigCache.delete(cwd);
  }

  const configPath = findConfigPath(cwd);
  if (!configPath) {
    throw new ConfigError(
      `No config file found in ${cwd}. Expected one of: ${CONFIG_CANDIDATES.join(', ')}`,
    );
  }

  const mtimeMs = statSync(configPath).mtimeMs;
  const cached = mergedConfigCache.get(cwd);
  if (!options?.reload && cached && cached.mtimeMs === mtimeMs) {
    return cached.config;
  }

  const raw = await loadRawConfig(cwd, { configPath, mtimeMs, reload: options?.reload });
  ensureAssetLinks(cwd, raw.assetLinks);
  const merged = mergeConfig(raw);
  mergedConfigCache.set(cwd, { mtimeMs, config: merged });
  return merged;
}
