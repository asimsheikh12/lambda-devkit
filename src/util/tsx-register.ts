import { importPeerFromConsumer, MissingPeerError } from '../peer-resolve.js';

let tsxRegistered = false;

export async function ensureTsxRegistered(cwd: string, feature: string): Promise<void> {
  if (tsxRegistered) {
    return;
  }

  try {
    const mod = await importPeerFromConsumer(cwd, 'tsx/esm/api', feature);
    const register = mod.register as (() => void) | undefined;
    if (typeof register !== 'function') {
      throw new Error('tsx register() not found');
    }
    register();
    tsxRegistered = true;
  } catch (error) {
    if (error instanceof MissingPeerError) {
      throw error;
    }
    throw new Error(
      `TypeScript support requires the optional peer "tsx". Install with: npm i -D tsx (${feature})`,
    );
  }
}

/** Visible for tests only. */
export function resetTsxRegistrationForTests(): void {
  tsxRegistered = false;
}
