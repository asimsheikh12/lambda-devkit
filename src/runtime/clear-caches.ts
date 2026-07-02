import { clearPlainHandlerCache } from './handler-cache.js';
import { clearAssetLinkCache } from './asset-links.js';
import { clearConfigCache } from '../config/load.js';
import { clearPeerImportCache } from '../peer-resolve.js';

/** Clears the handler module cache (use with `--reload`). */
export function clearAllHandlerCaches(): void {
  clearPlainHandlerCache();
}

/** Clears config, asset-link, peer-import, and handler caches. */
export function clearAllRuntimeCaches(): void {
  clearAllHandlerCaches();
  clearConfigCache();
  clearAssetLinkCache();
  clearPeerImportCache();
}

/** @alias clearAllHandlerCaches */
export const clearHandlerCache = clearAllHandlerCaches;
