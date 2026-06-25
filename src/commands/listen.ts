import { loadConfig } from '../config/load.js';
import { resolveFunction } from '../config/merge.js';
import { listenSqsQueue } from '../aws/sqs-listen.js';

export type ListenCommandOptions = {
  cwd?: string;
  batchSize?: number;
  batchInvoke?: boolean;
  noBatchInvoke?: boolean;
  noDelete?: boolean;
  once?: boolean;
  expectMessages?: boolean;
  noExtendVisibility?: boolean;
  reload?: boolean;
  queueUrl?: string;
};

export function resolveListenExitCode(
  result: { failures: number; messagesReceived: number },
  options: { expectMessages?: boolean },
): number {
  if (result.failures > 0) {
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
  const config = await loadConfig(cwd);
  const fn = resolveFunction(config, functionName);
  const mergedFn = { ...fn };

  if (options.queueUrl) {
    mergedFn.aws = { ...mergedFn.aws, queueUrl: options.queueUrl };
  }

  const result = await listenSqsQueue({
    fn: mergedFn,
    cwd,
    batchSize: options.batchSize,
    batchInvoke: options.noBatchInvoke ? false : (options.batchInvoke ?? true),
    deleteOnSuccess: !options.noDelete,
    once: options.once,
    reload: options.reload,
    extendVisibility: !options.noExtendVisibility,
    onMessage: (messageId, status) => {
      console.log(`message ${messageId}: ${status}`);
    },
  });

  return resolveListenExitCode(result, options);
}
