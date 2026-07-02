import { loadConfig as loadMergedConfig, type LoadConfigOptions } from '../config/load.js';
import { resolveFunction } from '../config/merge.js';

export async function resolveConfigFunction(
  functionName: string,
  cwd: string = process.cwd(),
  options?: LoadConfigOptions,
) {
  const config = await loadMergedConfig(cwd, options);
  const fn = resolveFunction(config, functionName);
  return { config, fn };
}
