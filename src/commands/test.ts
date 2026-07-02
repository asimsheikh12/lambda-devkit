import { spawnSync } from 'node:child_process';
import pc from 'picocolors';
import { loadConfig, type LoadConfigOptions } from '../config/load.js';
import { resolveFunction, type MergedFunctionConfig } from '../config/merge.js';
import { buildEventForTrigger } from '../events/index.js';
import { queueArnFromUrl } from '../events/sqs-record.js';
import { resetColdStart, setInitDurationMs } from '../runtime/context.js';
import { clearAllHandlerCaches, clearAllRuntimeCaches } from '../runtime/clear-caches.js';
import { countBatchItemFailures } from '../aws/batch-response.js';
import { invokeHandler, type InvokeResult } from '../runtime/invoke.js';
import { loadHandler } from '../runtime/loader.js';
import { readPayloadFile, resolvePayload } from '../util/payload.js';

export type TestCommandOptions = {
  cwd?: string;
  data?: string;
  dataFile?: string;
  eventPath?: string;
  env?: string[];
  all?: boolean;
  parallel?: boolean;
  dryRun?: boolean;
  cold?: boolean;
  reload?: boolean;
  reloadConfig?: boolean;
  batchSize?: number;
  verbose?: boolean;
  pretty?: boolean;
  rawLogs?: boolean;
  inspect?: boolean;
  inspectBrk?: boolean;
  strictBatch?: boolean;
};

function applyEnvOverrides(envVars?: string[]): void {
  for (const entry of envVars ?? []) {
    const eqIndex = entry.indexOf('=');
    if (eqIndex <= 0) {
      throw new Error(`Invalid --env value "${entry}". Expected KEY=value`);
    }
    process.env[entry.slice(0, eqIndex)] = entry.slice(eqIndex + 1);
  }
}

function resolveEvent(
  fn: MergedFunctionConfig,
  options: TestCommandOptions,
): unknown {
  if (options.eventPath) {
    return readPayloadFile(options.eventPath, options.cwd ?? process.cwd());
  }

  const payload =
    resolvePayload({
      data: options.data,
      dataFile: options.dataFile,
      cwd: options.cwd,
    }) ?? fn.test?.data;

  const queueArn = fn.aws.queueUrl
    ? queueArnFromUrl(fn.aws.queueUrl, fn.region)
    : undefined;

  return buildEventForTrigger(fn.trigger, payload, {
    region: fn.region,
    batchSize: options.batchSize,
    queueArn,
  });
}

function maybeReexecForInspect(options: TestCommandOptions): void {
  if (!options.inspect && !options.inspectBrk) {
    return;
  }
  if (process.env.LAMKIT_REEXEC === '1') {
    return;
  }

  const inspectFlag = options.inspectBrk ? '--inspect-brk' : '--inspect';
  const result = spawnSync(
    process.execPath,
    [inspectFlag, process.argv[1]!, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: { ...process.env, LAMKIT_REEXEC: '1' },
    },
  );

  process.exit(result.status ?? 1);
}

export function resolveTestExitCode(
  result: InvokeResult,
  options: { strictBatch?: boolean } = {},
): number {
  if (!result.success) {
    return 1;
  }

  if (options.strictBatch && countBatchItemFailures(result.result) > 0) {
    return 1;
  }

  return 0;
}

function printTestResult(
  fn: MergedFunctionConfig,
  result: InvokeResult,
  pretty: boolean,
): void {
  if (pretty) {
    const status = result.success ? pc.green('✓') : pc.red('✗');
    console.log(`${status} ${fn.name} (${fn.trigger}) — ${Math.round(result.durationMs)}ms`);

    if (!result.success && result.error) {
      console.error(pc.red(result.error.message));
    }

    if (result.logs.length > 0) {
      console.log('\nLogs:');
      for (const logLine of result.logs) {
        console.log(logLine);
      }
    }
    return;
  }

  for (const logLine of result.logs) {
    console.log(logLine);
  }
}

function canRunParallelAll(options: TestCommandOptions): boolean {
  return (
    !!options.parallel &&
    !options.env?.length &&
    !options.reload &&
    !options.cold &&
    !options.inspect &&
    !options.inspectBrk
  );
}

async function runSingleFunctionTest(
  fn: MergedFunctionConfig,
  options: TestCommandOptions,
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();

  if (options.cold) {
    resetColdStart();
  }

  if (options.reload) {
    clearAllHandlerCaches();
  }

  applyEnvOverrides(options.env);

  const event = resolveEvent(fn, options);

  if (options.verbose) {
    console.error(pc.dim(`Function: ${fn.name} (${fn.trigger})`));
    console.error(pc.dim(`Entry: ${fn.entry}`));
  }

  if (options.dryRun) {
    console.log(JSON.stringify(event, null, 2));
    return 0;
  }

  const loadStarted = Date.now();
  const handler = await loadHandler(fn, cwd, { reload: options.reload });
  if (options.cold) {
    setInitDurationMs(Date.now() - loadStarted);
  }

  const result = await invokeHandler(handler, event, fn, { rawLogs: options.rawLogs });
  printTestResult(fn, result, options.pretty ?? true);

  return resolveTestExitCode(result, { strictBatch: options.strictBatch });
}

export async function runTestCommand(
  functionName: string | undefined,
  options: TestCommandOptions = {},
): Promise<number> {
  maybeReexecForInspect(options);

  const cwd = options.cwd ?? process.cwd();
  const configOptions: LoadConfigOptions | undefined = options.reloadConfig
    ? { reload: true }
    : undefined;

  if (options.reloadConfig) {
    clearAllRuntimeCaches();
  }

  const config = await loadConfig(cwd, configOptions);

  if (options.all) {
    if (canRunParallelAll(options)) {
      const codes = await Promise.all(
        config.functions.map((fn) => runSingleFunctionTest(fn, options)),
      );
      return codes.some((code) => code !== 0) ? 1 : 0;
    }

    let exitCode = 0;
    for (const fn of config.functions) {
      const code = await runSingleFunctionTest(fn, options);
      if (code !== 0) {
        exitCode = code;
      }
    }
    return exitCode;
  }

  const fn = resolveFunction(config, functionName);
  return runSingleFunctionTest(fn, options);
}
