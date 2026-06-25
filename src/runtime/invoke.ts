import type { Context } from 'aws-lambda';
import {
  createLogCapture,
  emitInvokeLogs,
  patchConsole,
  type LogCapture,
} from './logs.js';
import { createContext } from './context.js';
import type { MergedFunctionConfig } from '../config/merge.js';

/** Lambda handler signature — same as production `export const handler`. */
export type Handler = (
  event: unknown,
  context: Context,
  callback?: (error?: Error | string | null, result?: unknown) => void,
) => unknown | Promise<unknown>;

/** Result of a local `invokeHandler()` call. */
export type InvokeResult = {
  /** Simulated AWS request ID (UUID). */
  requestId: string;
  /** Wall-clock handler duration in milliseconds. */
  durationMs: number;
  /** Billed duration rounded up to 1 ms (matches Lambda REPORT). */
  billedDurationMs: number;
  /** Full stdout including START / END / REPORT lines. */
  logs: string[];
  /** Application `console.log` output only. */
  applicationLogs: string[];
  /** Handler return value when `success` is true. */
  result?: unknown;
  /** Thrown error when `success` is false. */
  error?: Error;
  /** False when the handler threw or timed out. */
  success: boolean;
};

export class InvokeTimeoutError extends Error {
  constructor(timeoutSeconds: number) {
    super(`Task timed out after ${timeoutSeconds} seconds`);
    this.name = 'InvokeTimeoutError';
  }
}

function invokeWithCallback(
  handler: Handler,
  event: unknown,
  context: Context,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const callback = (error?: Error | string | null, result?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve(result);
    };

    try {
      const maybePromise = handler(event, context, callback);
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        (maybePromise as Promise<unknown>)
          .then((result) => {
            if (!settled) {
              settled = true;
              resolve(result);
            }
          })
          .catch((error: unknown) => {
            if (!settled) {
              settled = true;
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
      } else if (!settled) {
        settled = true;
        resolve(maybePromise);
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
}

async function runHandler(
  handler: Handler,
  event: unknown,
  context: Context,
): Promise<unknown> {
  const timeoutMs = context.getRemainingTimeInMillis();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      invokeWithCallback(handler, event, context),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new InvokeTimeoutError(Math.ceil(timeoutMs / 1000)));
        }, timeoutMs);
      }),
    ]);

    return result;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export async function invokeHandler(
  handler: Handler,
  event: unknown,
  fn: MergedFunctionConfig,
  options?: { context?: Context; logCapture?: LogCapture },
): Promise<InvokeResult> {
  const context = options?.context ?? createContext(fn);
  const capture = options?.logCapture ?? createLogCapture();
  const applicationLogs: string[] = [];
  const consolePatch = patchConsole((line) => applicationLogs.push(line));

  const startedAt = Date.now();

  try {
    const result = await runHandler(handler, event, context);
    const durationMs = Date.now() - startedAt;
    const awsLogs = emitInvokeLogs(
      capture,
      context.awsRequestId,
      durationMs,
      fn,
      applicationLogs,
    );

    return {
      requestId: context.awsRequestId,
      durationMs,
      billedDurationMs: Math.ceil(durationMs / 100) * 100,
      logs: awsLogs,
      applicationLogs,
      result,
      success: true,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const err = error instanceof Error ? error : new Error(String(error));
    const awsLogs = emitInvokeLogs(
      capture,
      context.awsRequestId,
      durationMs,
      fn,
      [...applicationLogs, err.stack ?? err.message],
    );

    return {
      requestId: context.awsRequestId,
      durationMs,
      billedDurationMs: Math.ceil(durationMs / 100) * 100,
      logs: awsLogs,
      applicationLogs,
      error: err,
      success: false,
    };
  } finally {
    consolePatch.restore();
  }
}
