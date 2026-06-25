import { clearPlainHandlerCache } from './handler-cache.js';

/** Clears the handler module cache (use with `--reload`). */
export function clearAllHandlerCaches(): void {
  clearPlainHandlerCache();
}

/** @alias clearAllHandlerCaches */
export const clearHandlerCache = clearAllHandlerCaches;
