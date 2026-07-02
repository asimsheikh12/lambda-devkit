import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export type PayloadSourceOptions = {
  data?: string;
  dataFile?: string;
  message?: string;
  cwd?: string;
};

export function readPayloadFile(filePath: string, cwd: string = process.cwd()): unknown {
  const resolved = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  if (!existsSync(resolved)) {
    throw new Error(`Payload file not found: ${resolved}`);
  }

  const raw = readFileSync(resolved, 'utf8');
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Resolve CLI payload from --data, --data-file, --message, or @path shorthand.
 * --message returns a raw string body; --data/--data-file parse JSON when possible.
 */
export function resolvePayload(options: PayloadSourceOptions): unknown {
  if (options.message !== undefined) {
    return options.message;
  }

  if (options.dataFile !== undefined) {
    return readPayloadFile(options.dataFile, options.cwd);
  }

  if (options.data === undefined) {
    return undefined;
  }

  if (options.data.startsWith('@')) {
    return readPayloadFile(options.data.slice(1), options.cwd);
  }

  try {
    return JSON.parse(options.data) as unknown;
  } catch {
    return options.data;
  }
}
