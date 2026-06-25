import { z } from 'zod';
import type {
  AssetLink,
  DefaultsConfig,
  FunctionConfig,
  LamkitConfig,
  LamkitConfigInput,
  Trigger,
} from './types.js';

export type {
  AssetLink,
  AwsResourceConfig,
  DefaultsAwsConfig,
  DefaultsConfig,
  FunctionConfig,
  LamkitConfig,
  LamkitConfigInput,
  LamkitMultiFunctionConfig,
  LamkitSingleFunctionConfig,
  LogFormat,
  TestConfig,
  Trigger,
} from './types.js';

export const triggerSchema = z.enum([
  'sqs',
  'http',
  'sns',
  's3',
  'eventbridge',
  'schedule',
]);

export const logFormatSchema = z.enum(['text', 'json']);

const awsResourceSchema = z.object({
  queueUrl: z.string().url().optional(),
  topicArn: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  endpoint: z.string().url().optional(),
}) satisfies z.ZodType<import('./types.js').AwsResourceConfig>;

const testConfigSchema = z.object({
  data: z.unknown().optional(),
}) satisfies z.ZodType<import('./types.js').TestConfig>;

const assetLinkSchema = z.object({
  path: z.string().min(1),
  target: z.string().min(1),
}) satisfies z.ZodType<AssetLink>;

const functionSchema = z.object({
  name: z.string().min(1),
  entry: z.string().min(1),
  trigger: triggerSchema.optional(),
  memorySize: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
  logFormat: logFormatSchema.optional(),
  test: testConfigSchema.optional(),
  aws: awsResourceSchema.optional(),
}) satisfies z.ZodType<FunctionConfig>;

const defaultsSchema = z.object({
  runtime: z.string().min(1).optional(),
  memorySize: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
  logFormat: logFormatSchema.optional(),
  tracing: z.boolean().optional(),
  aws: awsResourceSchema.pick({ region: true, endpoint: true }).optional(),
}) satisfies z.ZodType<DefaultsConfig>;

const singleFunctionSugarSchema = z
  .object({
    name: z.string().min(1).optional(),
    entry: z.string().min(1),
    trigger: triggerSchema.optional(),
    memorySize: z.number().int().positive().optional(),
    timeout: z.number().int().positive().optional(),
    logFormat: logFormatSchema.optional(),
    test: testConfigSchema.optional(),
    aws: awsResourceSchema.optional(),
    assetLinks: z.array(assetLinkSchema).optional(),
    defaults: defaultsSchema.optional(),
    functions: z.never().optional(),
  })
  .strict() satisfies z.ZodType<import('./types.js').LamkitSingleFunctionConfig>;

const multiFunctionSchema = z
  .object({
    defaults: defaultsSchema.optional(),
    assetLinks: z.array(assetLinkSchema).optional(),
    functions: z.array(functionSchema).min(1),
  })
  .strict() satisfies z.ZodType<import('./types.js').LamkitMultiFunctionConfig>;

const rawConfigSchema = z.union([singleFunctionSugarSchema, multiFunctionSchema]);

function normalizeSugar(
  input: z.infer<typeof singleFunctionSugarSchema>,
): LamkitConfig {
  const { defaults, name, entry, trigger, memorySize, timeout, logFormat, test, aws, assetLinks } =
    input;

  return {
    defaults,
    assetLinks,
    functions: [
      {
        name: name ?? 'default',
        entry,
        trigger,
        memorySize,
        timeout,
        logFormat,
        test,
        aws,
      },
    ],
  };
}

function isMultiFunctionConfig(
  parsed: z.infer<typeof rawConfigSchema>,
): parsed is LamkitConfig {
  return 'functions' in parsed && Array.isArray(parsed.functions);
}

/**
 * Parse and validate config from an unknown value (e.g. imported config module).
 * Throws `ZodError` when invalid — use `formatZodError()` for a readable message.
 */
export function parseConfig(input: unknown): LamkitConfig {
  const parsed = rawConfigSchema.parse(input);

  if (isMultiFunctionConfig(parsed)) {
    return parsed;
  }

  return normalizeSugar(parsed);
}

/**
 * Type-safe config helper for `lamkit.config.ts`.
 * Provides autocomplete and JSDoc hovers on every field.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'aws-lambda-devkit';
 *
 * export default defineConfig({
 *   functions: [{ name: 'worker', entry: './dist/handler.js', trigger: 'sqs' }],
 * });
 * ```
 */
export function defineConfig(config: LamkitConfigInput): LamkitConfig {
  return parseConfig(config);
}

/** Format a Zod validation error as `path: message` lines. */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('\n');
}
