import { existsSync } from 'node:fs';
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

export function findConfigPath(cwd: string = process.cwd()): string | null {
  for (const filename of CONFIG_CANDIDATES) {
    const fullPath = join(cwd, filename);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

async function importConfigModule(configPath: string, cwd: string): Promise<unknown> {
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

  const moduleUrl = `${pathToFileURL(configPath).href}?t=${Date.now()}`;
  const imported = await import(moduleUrl);
  return imported.default ?? imported;
}

export async function loadRawConfig(cwd: string = process.cwd()): Promise<LamkitConfig> {
  const configPath = findConfigPath(cwd);
  if (!configPath) {
    throw new ConfigError(
      `No config file found in ${cwd}. Expected one of: ${CONFIG_CANDIDATES.join(', ')}`,
    );
  }

  try {
    const raw = await importConfigModule(configPath, cwd);

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

export async function loadConfig(cwd: string = process.cwd()): Promise<MergedConfig> {
  const raw = await loadRawConfig(cwd);
  ensureAssetLinks(cwd, raw.assetLinks);
  return mergeConfig(raw);
}
