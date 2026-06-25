import type { Handler } from './invoke.js';

const handlerCache = new Map<string, Handler>();

export function handlerCacheKey(cwd: string, entryPath: string): string {
  return `${cwd}\0${entryPath}`;
}

export function getCachedHandler(key: string): Handler | undefined {
  return handlerCache.get(key);
}

export function setCachedHandler(key: string, handler: Handler): void {
  handlerCache.set(key, handler);
}

export function clearPlainHandlerCache(): void {
  handlerCache.clear();
}
