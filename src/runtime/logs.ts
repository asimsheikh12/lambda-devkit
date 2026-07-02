import type { MergedFunctionConfig } from '../config/merge.js';
import { getInitDurationMs, isColdStart, markWarm } from './context.js';

export type LogCapture = {
  lines: string[];
  write(line: string): void;
};

export function createLogCapture(): LogCapture {
  const lines: string[] = [];
  return {
    lines,
    write(line: string) {
      lines.push(line);
    },
  };
}

export function formatStart(requestId: string): string {
  return `START RequestId: ${requestId} Version: $LATEST`;
}

export function formatEnd(requestId: string): string {
  return `END RequestId: ${requestId}`;
}

export function roundBilledDuration(durationMs: number): number {
  return Math.ceil(durationMs / 100) * 100;
}

export function formatReport(
  requestId: string,
  durationMs: number,
  fn: MergedFunctionConfig,
  options?: { initDurationMs?: number },
): string {
  const billed = roundBilledDuration(durationMs);
  const parts = [
    `REPORT RequestId: ${requestId}`,
    `Duration: ${durationMs.toFixed(2)} ms`,
    `Billed Duration: ${billed} ms`,
  ];

  if (options?.initDurationMs !== undefined && options.initDurationMs > 0) {
    parts.push(`Init Duration: ${options.initDurationMs.toFixed(2)} ms`);
  }

  parts.push(`Memory Size: ${fn.memorySize} MB`);
  parts.push(`Max Memory Used: ${Math.min(fn.memorySize, Math.max(64, Math.ceil(fn.memorySize * 0.12)))} MB`);

  if (fn.tracing) {
    parts.push('X-Ray Trace Id: local-dev-trace');
  }

  return parts.join('\t');
}

export function resolveInitDuration(cold: boolean, initDurationMs?: number): number | undefined {
  if (!cold) {
    return undefined;
  }
  return initDurationMs ?? 0;
}

export type ConsolePatch = {
  restore(): void;
};

const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;

export function patchConsole(
  write: (line: string) => void,
  options?: { forward?: boolean },
): ConsolePatch {
  const forward = options?.forward ?? true;
  const originals = new Map<string, (...args: unknown[]) => void>();

  for (const method of consoleMethods) {
    const original = console[method] as (...args: unknown[]) => void;
    originals.set(method, original.bind(console));

    console[method] = (...args: unknown[]) => {
      const formatted = args
        .map((arg) => {
          if (typeof arg === 'string') {
            return arg;
          }
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(' ');

      write(formatted);
      if (forward) {
        original(...args);
      }
    };
  }

  return {
    restore() {
      for (const method of consoleMethods) {
        const original = originals.get(method);
        if (original) {
          console[method] = original as never;
        }
      }
    },
  };
}

export function emitInvokeLogs(
  capture: LogCapture,
  requestId: string,
  durationMs: number,
  fn: MergedFunctionConfig,
  applicationLines: string[],
): string[] {
  const initDurationMs = resolveInitDuration(isColdStart(), getInitDurationMs());
  markWarm();

  if (fn.logFormat === 'json') {
    return emitJsonInvokeLogs(
      capture,
      requestId,
      durationMs,
      fn,
      applicationLines,
      initDurationMs,
    );
  }

  const awsLines = [
    formatStart(requestId),
    ...applicationLines,
    formatEnd(requestId),
    formatReport(requestId, durationMs, fn, { initDurationMs }),
  ];

  for (const line of awsLines) {
    capture.write(line);
  }

  return awsLines;
}

function jsonLogLine(type: string, record: Record<string, unknown>): string {
  return JSON.stringify({
    time: new Date().toISOString(),
    type,
    record,
  });
}

function emitJsonInvokeLogs(
  capture: LogCapture,
  requestId: string,
  durationMs: number,
  fn: MergedFunctionConfig,
  applicationLines: string[],
  initDurationMs?: number,
): string[] {
  const billed = roundBilledDuration(durationMs);
  const awsLines = [
    jsonLogLine('platform.start', { requestId, version: '$LATEST' }),
    ...applicationLines.map((message) =>
      jsonLogLine('platform.log', { requestId, message }),
    ),
    jsonLogLine('platform.end', { requestId }),
    jsonLogLine('platform.report', {
      requestId,
      durationMs,
      billedDurationMs: billed,
      ...(initDurationMs !== undefined && initDurationMs > 0
        ? { initDurationMs }
        : {}),
      memorySizeMb: fn.memorySize,
      maxMemoryUsedMb: Math.min(
        fn.memorySize,
        Math.max(64, Math.ceil(fn.memorySize * 0.12)),
      ),
      ...(fn.tracing ? { traceId: 'local-dev-trace' } : {}),
    }),
  ];

  for (const line of awsLines) {
    capture.write(line);
  }

  return awsLines;
}
