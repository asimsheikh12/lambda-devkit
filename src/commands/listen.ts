import { loadConfig, type LoadConfigOptions } from '../config/load.js';
import { resolveFunction } from '../config/merge.js';
import { clearAllRuntimeCaches } from '../runtime/clear-caches.js';
import { listenSqsQueue } from '../aws/sqs-listen.js';

export type ListenCommandOptions = {
  cwd?: string;
  batchSize?: number;
  /** Commander sets this from `--no-batch-invoke` (default: true). */
  batchInvoke?: boolean;
  /** Commander sets this from `--no-delete` (default: true). */
  delete?: boolean;
  /** Commander sets this from `--no-extend-visibility` (default: true). */
  extendVisibility?: boolean;
  once?: boolean;
  expectMessages?: boolean;
  strictFailures?: boolean;
  reload?: boolean;
  reloadConfig?: boolean;
  rawLogs?: boolean;
  queueUrl?: string;
};

export function resolveListenCommandFlags(options: ListenCommandOptions): {
  batchInvoke: boolean;
  deleteOnSuccess: boolean;
  extendVisibility: boolean;
} {
  return {
    batchInvoke: options.batchInvoke ?? true,
    deleteOnSuccess: options.delete ?? true,
    extendVisibility: options.extendVisibility ?? true,
  };
}

export function resolveListenExitCode(
  result: { failures: number; messagesReceived: number; processed: number },
  options: { expectMessages?: boolean; strictFailures?: boolean } = {},
): number {
  if (options.strictFailures && result.failures > 0) {
    return 1;
  }

  if (!options.strictFailures && result.failures > 0 && result.processed === 0) {
    return 1;
  }

  if (options.expectMessages && result.messagesReceived === 0) {
    return 1;
  }

  return 0;
}

export async function runListenCommand(
  functionName: string | undefined,
  options: ListenCommandOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const configOptions: LoadConfigOptions | undefined = options.reloadConfig
    ? { reload: true }
    : undefined;

  if (options.reloadConfig) {
    clearAllRuntimeCaches();
  }

  const config = await loadConfig(cwd, configOptions);
  const fn = resolveFunction(config, functionName);
  const mergedFn = { ...fn };

  if (options.queueUrl) {
    mergedFn.aws = { ...mergedFn.aws, queueUrl: options.queueUrl };
  }

  const flags = resolveListenCommandFlags(options);

  const result = await listenSqsQueue({
    fn: mergedFn,
    cwd,
    batchSize: options.batchSize,
    batchInvoke: flags.batchInvoke,
    deleteOnSuccess: flags.deleteOnSuccess,
    once: options.once,
    reload: options.reload,
    extendVisibility: flags.extendVisibility,
    rawLogs: options.rawLogs,
    onMessage: (messageId, status) => {
      console.log(`message ${messageId}: ${status}`);
    },
  });

  return resolveListenExitCode(result, options);
}
