import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export class MissingPeerError extends Error {
  constructor(packageName: string, feature: string) {
    super(
      `Optional peer "${packageName}" is required for ${feature}. Install with: npm i -D ${packageName}`,
    );
    this.name = 'MissingPeerError';
  }
}

function createConsumerRequire(cwd: string) {
  const packageJsonPath = join(cwd, 'package.json');
  if (existsSync(packageJsonPath)) {
    return createRequire(packageJsonPath);
  }
  return createRequire(join(cwd, 'index.js'));
}

function isModuleNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as { code?: string; message?: string };
  if (err.code === 'MODULE_NOT_FOUND' || err.code === 'ERR_MODULE_NOT_FOUND') {
    return true;
  }

  return typeof err.message === 'string' && err.message.includes('Cannot find module');
}

export async function importPeerFromConsumer(
  cwd: string,
  specifier: string,
  feature: string,
): Promise<Record<string, unknown>> {
  try {
    const consumerRequire = createConsumerRequire(cwd);
    const resolved = consumerRequire.resolve(specifier);
    return (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof MissingPeerError) {
      throw error;
    }
    if (isModuleNotFoundError(error)) {
      throw new MissingPeerError(specifier, feature);
    }
    throw error;
  }
}
