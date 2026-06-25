import { loadConfig as loadMergedConfig } from '../config/load.js';
import { resolveFunction } from '../config/merge.js';

export async function resolveConfigFunction(
  functionName: string,
  cwd: string = process.cwd(),
) {
  const config = await loadMergedConfig(cwd);
  const fn = resolveFunction(config, functionName);
  return { config, fn };
}
