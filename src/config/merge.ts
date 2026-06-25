import type {
  AssetLink,
  DefaultsConfig,
  FunctionConfig,
  LamkitConfig,
  LogFormat,
  Trigger,
} from './types.js';

const DEFAULT_RUNTIME = 'nodejs20.x';
const DEFAULT_MEMORY = 512;
const DEFAULT_TIMEOUT = 30;
const DEFAULT_LOG_FORMAT = 'text' as const;
const DEFAULT_TRIGGER: Trigger = 'sqs';

/**
 * Fully resolved function config after merging `defaults` and env fallbacks.
 * Used internally by the CLI; exported for tooling and tests.
 */
export type MergedFunctionConfig = Required<
  Pick<FunctionConfig, 'name' | 'entry'>
> & {
  trigger: Trigger;
  runtime: string;
  memorySize: number;
  timeout: number;
  logFormat: LogFormat;
  tracing: boolean;
  region: string;
  test?: FunctionConfig['test'];
  aws: {
    queueUrl?: string;
    topicArn?: string;
    endpoint?: string;
  };
};

/** Config after defaults, env, and per-function fields are merged. */
export type MergedConfig = {
  defaults: Required<
    Pick<DefaultsConfig, 'runtime' | 'memorySize' | 'timeout' | 'logFormat' | 'tracing'>
  > & {
    region: string;
    aws: {
      endpoint?: string;
    };
  };
  assetLinks: AssetLink[];
  functions: MergedFunctionConfig[];
};

function resolveRegion(defaults?: DefaultsConfig): string {
  return (
    defaults?.aws?.region ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    'us-east-1'
  );
}

export function mergeConfig(config: LamkitConfig): MergedConfig {
  const defaults = config.defaults;
  const mergedDefaults = {
    runtime: defaults?.runtime ?? DEFAULT_RUNTIME,
    memorySize: defaults?.memorySize ?? DEFAULT_MEMORY,
    timeout: defaults?.timeout ?? DEFAULT_TIMEOUT,
    logFormat: defaults?.logFormat ?? DEFAULT_LOG_FORMAT,
    tracing: defaults?.tracing ?? false,
    region: resolveRegion(defaults),
    aws: {
      endpoint: defaults?.aws?.endpoint,
    },
  };

  const functions = config.functions.map((fn) => mergeFunction(fn, mergedDefaults));

  return {
    defaults: mergedDefaults,
    assetLinks: config.assetLinks ?? [],
    functions,
  };
}

function mergeFunction(
  fn: FunctionConfig,
  defaults: MergedConfig['defaults'],
): MergedFunctionConfig {
  return {
    name: fn.name,
    entry: fn.entry,
    trigger: fn.trigger ?? DEFAULT_TRIGGER,
    runtime: defaults.runtime,
    memorySize: fn.memorySize ?? defaults.memorySize,
    timeout: fn.timeout ?? defaults.timeout,
    logFormat: fn.logFormat ?? defaults.logFormat,
    tracing: defaults.tracing,
    region: fn.aws?.region ?? defaults.region,
    test: fn.test,
    aws: {
      queueUrl: fn.aws?.queueUrl,
      topicArn: fn.aws?.topicArn,
      endpoint: fn.aws?.endpoint ?? defaults.aws.endpoint,
    },
  };
}

export function resolveFunction(
  config: MergedConfig,
  name?: string,
): MergedFunctionConfig {
  if (!name) {
    if (config.functions.length === 1) {
      return config.functions[0]!;
    }
    throw new Error(
      `Function name required. Available: ${config.functions.map((f) => f.name).join(', ')}`,
    );
  }

  const fn = config.functions.find((f) => f.name === name);
  if (!fn) {
    throw new Error(
      `Unknown function "${name}". Available: ${config.functions.map((f) => f.name).join(', ')}`,
    );
  }

  return fn;
}

const SECRET_KEY_PATTERN = /secret|password|token|credential|api[_-]?key/i;

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key) && typeof entry === 'string') {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSecrets(entry);
      }
    }
    return result;
  }

  return value;
}

export function maskUrl(url: string): string {
  if (url.length <= 24) {
    return url;
  }
  return `${url.slice(0, 20)}…${url.slice(-8)}`;
}
