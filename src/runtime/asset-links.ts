import { existsSync, lstatSync, symlinkSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type { AssetLink } from '../config/types.js';

export type { AssetLink };

export class AssetLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetLinkError';
  }
}

/**
 * Ensure local asset paths exist before loading handlers.
 *
 * Compiled Lambda bundles often `require()` paths relative to `dist/` (e.g.
 * `../../abis/foo.json`). In Docker those folders are copied next to `dist/`;
 * in a monorepo they may only exist under `src/`. Declaring `assetLinks` creates
 * a symlink when `path` is missing and `target` exists.
 */
export function ensureAssetLinks(cwd: string, links: AssetLink[] | undefined): void {
  for (const link of links ?? []) {
    ensureAssetLink(cwd, link);
  }
}

function ensureAssetLink(cwd: string, { path, target }: AssetLink): void {
  const linkPath = resolve(cwd, path);
  const targetPath = resolve(cwd, target);

  if (!existsSync(targetPath)) {
    throw new AssetLinkError(
      `assetLinks: target does not exist: ${target} (resolved: ${targetPath})`,
    );
  }

  if (existsSync(linkPath)) {
    return;
  }

  const targetStat = lstatSync(targetPath);
  const linkType = targetStat.isDirectory() ? 'dir' : 'file';
  const relTarget = relative(dirname(linkPath), targetPath);

  try {
    symlinkSync(relTarget, linkPath, linkType);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AssetLinkError(
      `assetLinks: failed to link ${path} -> ${target}: ${message}`,
    );
  }
}
