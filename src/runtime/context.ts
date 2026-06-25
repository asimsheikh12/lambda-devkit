import { randomUUID } from 'node:crypto';
import type { Context } from 'aws-lambda';
import type { MergedFunctionConfig } from '../config/merge.js';

let coldStart = true;
let initDurationMs: number | undefined;

export function resetColdStart(): void {
  coldStart = true;
  initDurationMs = undefined;
}

export function isColdStart(): boolean {
  return coldStart;
}

export function markWarm(): void {
  coldStart = false;
}

export function setInitDurationMs(ms: number): void {
  initDurationMs = ms;
}

export function getInitDurationMs(): number | undefined {
  return initDurationMs;
}

export function createContext(fn: MergedFunctionConfig): Context {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const timeoutMs = fn.timeout * 1000;

  return {
    callbackWaitsForEmptyEventLoop: true,
    functionName: fn.name,
    functionVersion: '$LATEST',
    invokedFunctionArn: `arn:aws:lambda:${fn.region}:000000000000:function:${fn.name}`,
    memoryLimitInMB: String(fn.memorySize),
    awsRequestId: requestId,
    logGroupName: `/aws/lambda/${fn.name}`,
    logStreamName: new Date().toISOString().slice(0, 10).replace(/-/g, '/') + '/[$LATEST]',
    getRemainingTimeInMillis: () => Math.max(0, timeoutMs - (Date.now() - startedAt)),
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
  };
}

export function getRequestId(context: Context): string {
  return context.awsRequestId;
}
