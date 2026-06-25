import { existsSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MergedFunctionConfig } from '../config/merge.js';
import type { Handler } from './invoke.js';
import {
  getCachedHandler,
  handlerCacheKey,
  setCachedHandler,
} from './handler-cache.js';

export { clearAllHandlerCaches, clearHandlerCache } from './clear-caches.js';

export class HandlerLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandlerLoadError';
  }
}

export function resolveEntryPath(entry: string, cwd: string = process.cwd()): string {
  const absoluteEntry = resolve(cwd, entry);

  if (extname(absoluteEntry) !== '.ts') {
    return absoluteEntry;
  }

  const rel = relative(cwd, absoluteEntry);
  if (rel.startsWith('src/')) {
    const distPath = join(cwd, rel.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js'));
    if (existsSync(distPath)) {
      return distPath;
    }
  }

  const jsSibling = absoluteEntry.replace(/\.ts$/, '.js');
  if (existsSync(jsSibling)) {
    return jsSibling;
  }

  return absoluteEntry;
}

import { MissingPeerError } from '../peer-resolve.js';
import { ensureTsxRegistered } from '../util/tsx-register.js';

async function ensureHandlerTsxRegistered(cwd: string): Promise<void> {
  try {
    await ensureTsxRegistered(cwd, 'TypeScript handler entries');
  } catch (error) {
    if (error instanceof MissingPeerError) {
      throw new HandlerLoadError(error.message);
    }
    throw new HandlerLoadError(
      'TypeScript handler entry requires the optional peer "tsx". Install with: npm i -D tsx',
    );
  }
}

export async function importEntryModule(
  entryPath: string,
  cwd: string = process.cwd(),
  options?: { reload?: boolean },
): Promise<Record<string, unknown>> {
  const resolved = resolveEntryPath(entryPath, cwd);

  if (resolved.endsWith('.ts')) {
    await ensureHandlerTsxRegistered(cwd);
  }

  if (!existsSync(resolved)) {
    throw new HandlerLoadError(`Handler entry not found: ${resolved}`);
  }

  const cacheBust = options?.reload ? `?t=${Date.now()}` : '';
  const moduleUrl = `${pathToFileURL(resolved).href}${cacheBust}`;
  return (await import(moduleUrl)) as Record<string, unknown>;
}

export function extractHandler(moduleExports: Record<string, unknown>): Handler {
  const candidate = moduleExports.handler ?? moduleExports.default;

  if (typeof candidate !== 'function') {
    throw new HandlerLoadError(
      'Handler entry must export a named "handler" or default async function export.',
    );
  }

  return candidate as Handler;
}

export type LoadHandlerOptions = {
  /** Bypass the handler module cache (same as `lamkit test --reload`). */
  reload?: boolean;
};

export async function loadHandler(
  fn: MergedFunctionConfig,
  cwd: string = process.cwd(),
  options?: LoadHandlerOptions,
): Promise<Handler> {
  const resolved = resolveEntryPath(fn.entry, cwd);
  const cacheKey = handlerCacheKey(cwd, resolved);

  if (!options?.reload) {
    const cached = getCachedHandler(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const moduleExports = await importEntryModule(fn.entry, cwd, options);
  const handler = extractHandler(moduleExports);
  setCachedHandler(cacheKey, handler);
  return handler;
}
