/**
 * Event source simulated by `lamkit test`.
 *
 * - `sqs` — SQS batch (`event.Records[].body`)
 * - `http` — API Gateway HTTP API v2 (`event.body`, `requestContext`)
 * - `sns` — SNS notification (`event.Records[].Sns.Message`)
 * - `s3` — S3 object notification
 * - `eventbridge` — EventBridge custom event
 * - `schedule` — EventBridge scheduled invocation
 */
export type Trigger = 'sqs' | 'http' | 'sns' | 's3' | 'eventbridge' | 'schedule';

/** CloudWatch-style log lines (`text`) or one JSON object per line (`json`). */
export type LogFormat = 'text' | 'json';

/**
 * AWS resource settings for a function.
 * Used by `lamkit send sqs`, `lamkit send sns`, and `lamkit listen`.
 */
export interface AwsResourceConfig {
  /**
   * Full HTTPS queue URL.
   * Required for `lamkit send sqs` and `lamkit listen`.
   * Example: `https://sqs.us-east-1.amazonaws.com/123456789012/my-queue`
   */
  queueUrl?: string;

  /**
   * SNS topic ARN.
   * Required for `lamkit send sns`.
   * Example: `arn:aws:sns:us-east-1:123456789012:my-topic`
   */
  topicArn?: string;

  /**
   * AWS region (e.g. `us-east-1`, `eu-west-1`).
   * Overrides `defaults.aws.region` for this function.
   */
  region?: string;

  /**
   * Custom AWS-compatible endpoint (LocalStack, private gateway).
   * Example: `http://localhost:4566`
   */
  endpoint?: string;
}

/** Region and endpoint defaults shared by all functions. */
export interface DefaultsAwsConfig {
  /** Default AWS region when not set on a function or in `AWS_REGION`. */
  region?: string;

  /** Default custom endpoint for all functions (unless overridden per function). */
  endpoint?: string;
}

/**
 * Default test payload for `lamkit test`.
 * Ignored when you pass `--data`, `--data-file`, or `--event`.
 */
export interface TestConfig {
  /**
   * JSON-serializable message body for SQS/SNS triggers,
   * or request body for `http` trigger.
   */
  data?: unknown;
}

/**
 * Symlink a local folder before loading the handler.
 *
 * Use when compiled code under `dist/` reads paths like `../../contracts/abi.json`
 * but dev assets live under `src/contracts/`.
 */
export interface AssetLink {
  /**
   * Path relative to the project root (where `lamkit.config.*` lives).
   * Created as a symlink when missing. Example: `contracts`
   */
  path: string;

  /**
   * Existing directory to link to. Example: `src/contracts`
   */
  target: string;
}

/**
 * One Lambda function entry in `lamkit.config.*`.
 */
export interface FunctionConfig {
  /**
   * Unique name — passed to `lamkit test <name>`, `lamkit listen <name>`, etc.
   */
  name: string;

  /**
   * Path to the handler module, relative to the config file directory.
   * Must export a named `handler` or default async function.
   * Examples: `./dist/handler.js`, `./src/handler.ts` (requires `tsx` peer)
   */
  entry: string;

  /**
   * Event shape built by `lamkit test`. Default: `sqs`.
   */
  trigger?: Trigger;

  /** Simulated memory in MB. Overrides `defaults.memorySize`. */
  memorySize?: number;

  /** Simulated timeout in seconds. Overrides `defaults.timeout`. */
  timeout?: number;

  /** Log output format for this invoke. Overrides `defaults.logFormat`. */
  logFormat?: LogFormat;

  /** Default payload when `lamkit test` is run without CLI payload flags. */
  test?: TestConfig;

  /** Queue, topic, region, and endpoint for real AWS send/listen commands. */
  aws?: AwsResourceConfig;
}

/**
 * Shared settings applied to every function unless overridden per function.
 */
export interface DefaultsConfig {
  /** Node.js runtime label shown in REPORT line. Default: `nodejs20.x` */
  runtime?: string;

  /** Default simulated memory in MB. Default: `512` */
  memorySize?: number;

  /** Default simulated timeout in seconds. Default: `30` */
  timeout?: number;

  /** Default log format. Default: `text` */
  logFormat?: LogFormat;

  /** Include X-Ray tracing fields in the simulated context. Default: `false` */
  tracing?: boolean;

  /** Default region and endpoint for all functions. */
  aws?: DefaultsAwsConfig;
}

/**
 * Normalized config after parsing (always has a `functions` array).
 */
export interface LamkitConfig {
  /** Shared defaults for all functions. */
  defaults?: DefaultsConfig;

  /** Symlinks created before each handler load. */
  assetLinks?: AssetLink[];

  /** One entry per locally testable Lambda. At least one required. */
  functions: FunctionConfig[];
}

/**
 * Multi-function config — recommended when you have more than one Lambda.
 */
export interface LamkitMultiFunctionConfig {
  defaults?: DefaultsConfig;
  assetLinks?: AssetLink[];
  /** At least one function. Each must have `name` and `entry`. */
  functions: FunctionConfig[];
}

/**
 * Single-function shorthand — put function fields at the root instead of `functions[]`.
 *
 * `name` defaults to `"default"` when omitted.
 */
export interface LamkitSingleFunctionConfig {
  name?: string;
  entry: string;
  trigger?: Trigger;
  memorySize?: number;
  timeout?: number;
  logFormat?: LogFormat;
  test?: TestConfig;
  aws?: AwsResourceConfig;
  defaults?: DefaultsConfig;
  assetLinks?: AssetLink[];
  /** Do not set when using shorthand — use `functions` for multiple Lambdas. */
  functions?: never;
}

/**
 * Accepted shape for `defineConfig()` and raw `lamkit.config.*` exports.
 * Use `defineConfig()` in TypeScript for autocomplete and hover docs.
 */
export type LamkitConfigInput = LamkitMultiFunctionConfig | LamkitSingleFunctionConfig;
