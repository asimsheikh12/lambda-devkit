import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { listenSqsQueue } from '../dist/aws/sqs-listen.js';
import { sendSqsMessage } from '../dist/aws/sqs-send.js';
import { publishSnsMessage } from '../dist/aws/sns-publish.js';
import {
  countBatchItemFailures,
  isBatchItemFailures,
} from '../dist/aws/batch-response.js';
import {
  createVisibilityHeartbeat,
  resolveVisibilityExtensionSeconds,
} from '../dist/aws/sqs-visibility.js';
import {
  isMessageFailed,
  processSqsMessages,
} from '../dist/aws/sqs-process.js';
import { runSendSnsCommand, runSendSqsCommand } from '../dist/commands/send.js';
import { ConfigError, findConfigPath, loadConfig, loadRawConfig } from '../dist/config/load.js';
import { mergeConfig, maskUrl, redactSecrets, resolveFunction } from '../dist/config/merge.js';
import {
  formatZodError,
  parseConfig,
} from '../dist/config/schema.js';
import { buildEventForTrigger } from '../dist/events/index.js';
import { buildScheduledEvent } from '../dist/events/schedule.js';
import { buildEventBridgeEvent } from '../dist/events/eventbridge.js';
import { queueArnFromUrl } from '../dist/events/sqs-record.js';
import { serializePayload } from '../dist/events/util.js';
import {
  AssetLinkError,
  ensureAssetLinks,
} from '../dist/runtime/asset-links.js';
import {
  extractHandler,
  HandlerLoadError,
  loadHandler,
  resolveEntryPath,
} from '../dist/runtime/loader.js';
import { invokeHandler, InvokeTimeoutError } from '../dist/runtime/invoke.js';
import { createContext } from '../dist/runtime/context.js';
import { readPayloadFile, resolvePayload } from '../dist/util/payload.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, '..');

const plainFn = {
  name: 'plain',
  entry: './tests/fixtures/plain-handler/handler.js',
  trigger: 'sqs',
  runtime: 'nodejs20.x',
  memorySize: 128,
  timeout: 3,
  logFormat: 'text',
  tracing: false,
  region: 'us-east-1',
  aws: {},
};

describe('config validation exceptions', () => {
  it('rejects config without entry', () => {
    assert.throws(
      () => parseConfig({ functions: [{ name: 'x' }] }),
      (error) => error instanceof ZodError,
    );
  });

  it('rejects empty functions array', () => {
    assert.throws(
      () => parseConfig({ functions: [] }),
      (error) => error instanceof ZodError,
    );
  });

  it('rejects invalid queueUrl', () => {
    assert.throws(
      () =>
        parseConfig({
          functions: [
            {
              name: 'x',
              entry: './handler.js',
              aws: { queueUrl: 'not-a-url' },
            },
          ],
        }),
      (error) => error instanceof ZodError,
    );
  });

  it('rejects unknown top-level keys in strict multi-function config', () => {
    assert.throws(
      () =>
        parseConfig({
          functions: [{ name: 'x', entry: './handler.js' }],
          unknownField: true,
        }),
      (error) => error instanceof ZodError,
    );
  });

  it('formats Zod errors with dotted paths', () => {
    try {
      parseConfig({ functions: [{ name: 'x' }] });
      assert.fail('expected ZodError');
    } catch (error) {
      assert.ok(error instanceof ZodError);
      const formatted = formatZodError(error);
      assert.match(formatted, /entry|Invalid input/);
    }
  });

  it('normalizes single-function sugar with default name', () => {
    const config = parseConfig({ entry: './handler.js' });
    assert.equal(config.functions.length, 1);
    assert.equal(config.functions[0].name, 'default');
  });
});

describe('config load exceptions', () => {
  it('throws ConfigError when no config file exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamkit-no-config-'));
    try {
      await assert.rejects(() => loadConfig(dir), (error) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /No config file found/);
        return true;
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws ConfigError for invalid config module content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamkit-bad-config-'));
    try {
      writeFileSync(join(dir, 'lamkit.config.js'), 'export default { functions: [] };\n');
      await assert.rejects(() => loadRawConfig(dir), (error) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /Invalid lamkit config/);
        return true;
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('findConfigPath returns null in empty directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamkit-empty-'));
    try {
      assert.equal(findConfigPath(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveFunction exceptions', () => {
  const multi = mergeConfig({
    functions: [
      { name: 'alpha', entry: './a.js' },
      { name: 'beta', entry: './b.js' },
    ],
  });

  it('requires a name when multiple functions exist', () => {
    assert.throws(
      () => resolveFunction(multi),
      /Function name required/,
    );
  });

  it('throws for unknown function name', () => {
    assert.throws(
      () => resolveFunction(multi, 'missing'),
      /Unknown function "missing"/,
    );
  });

  it('returns the sole function when name is omitted', () => {
    const single = mergeConfig({
      functions: [{ name: 'only', entry: './handler.js' }],
    });
    assert.equal(resolveFunction(single).name, 'only');
  });
});

describe('handler loader exceptions', () => {
  it('throws HandlerLoadError for missing entry file', async () => {
    await assert.rejects(
      () =>
        loadHandler(
          { ...plainFn, entry: './tests/fixtures/does-not-exist.js' },
          repoRoot,
        ),
      (error) => {
        assert.ok(error instanceof HandlerLoadError);
        assert.match(error.message, /Handler entry not found/);
        return true;
      },
    );
  });

  it('throws HandlerLoadError when export is not a function', () => {
    assert.throws(
      () => extractHandler({ handler: 'not-a-function' }),
      (error) => {
        assert.ok(error instanceof HandlerLoadError);
        assert.match(error.message, /must export a named "handler"/);
        return true;
      },
    );
  });

  it('throws HandlerLoadError when module has no handler export', async () => {
    await assert.rejects(
      () =>
        loadHandler(
          { ...plainFn, entry: './tests/fixtures/bad-handler/no-export.js' },
          repoRoot,
        ),
      (error) => error instanceof HandlerLoadError,
    );
  });

  it('accepts default export as handler', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamkit-default-export-'));
    try {
      writeFileSync(join(dir, 'handler.js'), 'export default async () => ({ ok: true });\n');
      const handler = await loadHandler(
        { ...plainFn, entry: './handler.js' },
        dir,
      );
      assert.equal(typeof handler, 'function');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolveEntryPath prefers dist/ for src/*.ts when dist exists', () => {
    const resolved = resolveEntryPath('./src/cli.ts', repoRoot);
    assert.ok(resolved.endsWith('dist/cli.js'));
    assert.ok(existsSync(resolved));
  });
});

describe('payload exceptions and edge cases', () => {
  it('throws when payload file is missing', () => {
    assert.throws(
      () => readPayloadFile('tests/fixtures/missing.json', repoRoot),
      /Payload file not found/,
    );
  });

  it('returns raw string for non-JSON payload files', () => {
    const payload = readPayloadFile('tests/fixtures/plain-text-payload.txt', repoRoot);
    assert.equal(payload, 'plain text payload\n');
  });

  it('returns undefined when no payload source is given', () => {
    assert.equal(resolvePayload({}), undefined);
  });

  it('returns raw string for non-JSON inline --data', () => {
    assert.equal(resolvePayload({ data: 'hello' }), 'hello');
  });

  it('returns --message as raw string without JSON parsing', () => {
    assert.equal(resolvePayload({ message: '{"not":"parsed"}' }), '{"not":"parsed"}');
  });

  it('throws for @file shorthand when file is missing', () => {
    assert.throws(
      () => resolvePayload({ data: '@tests/fixtures/missing.json', cwd: repoRoot }),
      /Payload file not found/,
    );
  });
});

describe('invokeHandler edge cases', () => {
  it('handles callback errors passed as strings', async () => {
    const handler = (_event, _context, callback) => {
      callback('string failure');
    };
    const result = await invokeHandler(handler, {}, plainFn, {
      context: createContext(plainFn),
    });
    assert.equal(result.success, false);
    assert.equal(result.error?.message, 'string failure');
  });

  it('ignores duplicate callback invocation after promise resolves', async () => {
    const handler = async (_event, _context, callback) => {
      callback(null, { first: true });
      return { second: true };
    };
    const result = await invokeHandler(handler, {}, plainFn, {
      context: createContext(plainFn),
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.result, { first: true });
  });

  it('uses captureOnly without forwarding console to stdout', async () => {
    const logs = [];
    const original = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      const handler = async () => {
        console.log('captured-only');
        return 'ok';
      };
      const result = await invokeHandler(handler, {}, plainFn, {
        context: createContext(plainFn),
        captureOnly: true,
      });
      assert.equal(logs.length, 0);
      assert.ok(result.applicationLogs.includes('captured-only'));
    } finally {
      console.log = original;
    }
  });

  it('InvokeTimeoutError includes timeout seconds in message', () => {
    const error = new InvokeTimeoutError(3);
    assert.equal(error.name, 'InvokeTimeoutError');
    assert.match(error.message, /3 seconds/);
  });
});

describe('processSqsMessages edge cases', () => {
  it('returns empty result for zero messages', async () => {
    const result = await processSqsMessages({
      messages: [],
      handler: async () => ({}),
      fn: plainFn,
      queueArn: 'arn:aws:sqs:us-east-1:000000000000:queue',
      region: 'us-east-1',
    });
    assert.deepEqual(result, { processed: 0, failures: 0, messagesReceived: 0, logs: [] });
  });

  it('treats missing MessageId as unknown for failure matching', async () => {
    const handler = async () => {
      throw new Error('fail');
    };
    const result = await processSqsMessages({
      messages: [{ Body: '{}', ReceiptHandle: 'rh-1' }],
      handler,
      fn: plainFn,
      queueArn: 'arn:aws:sqs:us-east-1:000000000000:queue',
      region: 'us-east-1',
      deleteOnSuccess: false,
    });
    assert.equal(result.failures, 1);
  });

  it('does not delete when ReceiptHandle is missing', async () => {
    const deleted = [];
    const result = await processSqsMessages({
      messages: [{ MessageId: 'msg-1', Body: '{}' }],
      handler: async () => ({ ok: true }),
      fn: plainFn,
      queueArn: 'arn:aws:sqs:us-east-1:000000000000:queue',
      region: 'us-east-1',
      deleteOnSuccess: true,
      deleteMessages: async (handles) => deleted.push(...handles),
    });
    assert.equal(result.processed, 1);
    assert.equal(deleted.length, 0);
  });

  it('deletes only successful messages on partial batch failure', async () => {
    const deleted = [];
    const handler = async (event) => ({
      batchItemFailures: [{ itemIdentifier: event.Records[1].messageId }],
    });

    const result = await processSqsMessages({
      messages: [
        { MessageId: 'ok-1', ReceiptHandle: 'rh-1', Body: '{}' },
        { MessageId: 'fail-2', ReceiptHandle: 'rh-2', Body: '{}' },
        { MessageId: 'ok-3', ReceiptHandle: 'rh-3', Body: '{}' },
      ],
      handler,
      fn: plainFn,
      queueArn: 'arn:aws:sqs:us-east-1:000000000000:queue',
      region: 'us-east-1',
      batchInvoke: true,
      deleteOnSuccess: true,
      deleteMessages: async (handles) => deleted.push(...handles),
    });

    assert.equal(result.processed, 2);
    assert.equal(result.failures, 1);
    assert.deepEqual(deleted.sort(), ['rh-1', 'rh-3']);
  });

  it('isMessageFailed returns true when handler threw', () => {
    assert.equal(isMessageFailed({ success: false }, 'any'), true);
  });

  it('skips visibility heartbeat when no receipt handles', async () => {
    const calls = [];
    const heartbeat = createVisibilityHeartbeat({
      visibilitySeconds: 30,
      extendVisibility: async (handles) => calls.push(handles),
    });

    await processSqsMessages({
      messages: [{ MessageId: 'm1', Body: '{}' }],
      handler: async () => ({ ok: true }),
      fn: plainFn,
      queueArn: 'arn:aws:sqs:us-east-1:000000000000:queue',
      region: 'us-east-1',
      deleteOnSuccess: false,
      visibilityHeartbeat: heartbeat,
    });

    assert.equal(calls.length, 0);
  });
});

describe('batch response edge cases', () => {
  it('isBatchItemFailures rejects non-objects and missing arrays', () => {
    assert.equal(isBatchItemFailures(null), false);
    assert.equal(isBatchItemFailures({ batchItemFailures: 'nope' }), false);
    assert.equal(isBatchItemFailures({ batchItemFailures: [] }), true);
  });

  it('countBatchItemFailures returns 0 for non-batch results', () => {
    assert.equal(countBatchItemFailures(null), 0);
    assert.equal(countBatchItemFailures(undefined), 0);
    assert.equal(countBatchItemFailures({ ok: true }), 0);
    assert.equal(countBatchItemFailures({ batchItemFailures: [] }), 0);
  });
});

describe('queueArnFromUrl edge cases', () => {
  it('parses standard AWS queue URLs', () => {
    const arn = queueArnFromUrl(
      'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue.fifo',
      'us-east-1',
    );
    assert.equal(arn, 'arn:aws:sqs:us-east-1:123456789012:my-queue.fifo');
  });

  it('falls back for invalid URLs', () => {
    const arn = queueArnFromUrl('not-a-valid-url', 'eu-west-1');
    assert.equal(arn, 'arn:aws:sqs:eu-west-1:000000000000:local-queue');
  });

  it('parses LocalStack-style queue URLs', () => {
    const arn = queueArnFromUrl(
      'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/demo',
      'us-east-1',
    );
    assert.equal(arn, 'arn:aws:sqs:us-east-1:000000000000:demo');
  });
});

describe('visibility extension edge cases', () => {
  it('enforces minimum of 30 seconds', () => {
    assert.equal(resolveVisibilityExtensionSeconds(0, 5), 30);
  });

  it('caps at 43200 seconds (12 hours)', () => {
    assert.equal(resolveVisibilityExtensionSeconds(50000, 50000), 43200);
  });

  it('heartbeat stop is safe to call multiple times', async () => {
    let calls = 0;
    const heartbeat = createVisibilityHeartbeat({
      visibilitySeconds: 60,
      extendVisibility: async () => {
        calls += 1;
      },
    });
    await heartbeat.start(['rh-1']);
    assert.equal(calls, 1);
    heartbeat.stop();
    heartbeat.stop();
  });
});

describe('event builder edge cases', () => {
  it('builds schedule and eventbridge triggers', () => {
    const schedule = buildEventForTrigger('schedule', { cron: 'rate(5 minutes)' }, {
      region: 'us-east-1',
    });
    assert.equal(schedule.source, 'aws.events');
    assert.equal(schedule.region, 'us-east-1');

    const bridge = buildEventForTrigger('eventbridge', { userId: '42' }, {
      region: 'us-west-2',
    });
    assert.equal(bridge['detail-type'], 'lamkit.local');
    assert.deepEqual(bridge.detail, { userId: '42' });
    assert.equal(bridge.region, 'us-west-2');
  });

  it('uses default payloads when data is omitted', () => {
    const sqs = buildEventForTrigger('sqs', undefined, { region: 'us-east-1' });
    assert.equal(sqs.Records.length, 1);

    const s3 = buildEventForTrigger('s3', undefined, { region: 'us-east-1' });
    assert.equal(s3.Records[0].eventSource, 'aws:s3');
  });

  it('serializePayload handles string and nullish data', () => {
    assert.equal(serializePayload('raw'), 'raw');
    assert.equal(serializePayload(null), '{}');
    assert.equal(serializePayload(undefined), '{}');
  });
});

describe('mergeConfig utilities', () => {
  it('redacts secret-like keys recursively', () => {
    const redacted = redactSecrets({
      apiKey: 'secret-value',
      nested: { password: 'p', safe: 'ok' },
      items: [{ token: 't' }],
    });
    assert.equal(redacted.apiKey, '[REDACTED]');
    assert.equal(redacted.nested.password, '[REDACTED]');
    assert.equal(redacted.nested.safe, 'ok');
    assert.equal(redacted.items[0].token, '[REDACTED]');
  });

  it('maskUrl leaves short URLs unchanged', () => {
    assert.equal(maskUrl('https://short.io'), 'https://short.io');
  });

  it('maskUrl truncates long URLs', () => {
    const long = 'https://sqs.us-east-1.amazonaws.com/123456789012/very-long-queue-name';
    const masked = maskUrl(long);
    assert.ok(masked.includes('…'));
    assert.ok(masked.length < long.length);
  });

  it('defaults region from AWS_REGION env', () => {
    const previous = process.env.AWS_REGION;
    process.env.AWS_REGION = 'ap-south-1';
    try {
      const merged = mergeConfig({
        functions: [{ name: 'x', entry: './handler.js' }],
      });
      assert.equal(merged.defaults.region, 'ap-south-1');
    } finally {
      if (previous === undefined) {
        delete process.env.AWS_REGION;
      } else {
        process.env.AWS_REGION = previous;
      }
    }
  });
});

describe('asset link exceptions', () => {
  it('throws AssetLinkError when target does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamkit-asset-err-'));
    try {
      assert.throws(
        () => ensureAssetLinks(dir, [{ path: 'abis', target: 'missing/target' }]),
        (error) => {
          assert.ok(error instanceof AssetLinkError);
          assert.match(error.message, /target does not exist/);
          return true;
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent when link path already exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamkit-asset-idem-'));
    const targetDir = join(dir, 'src', 'data');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'file.json'), '{}');
    try {
      const links = [{ path: 'data', target: 'src/data' }];
      ensureAssetLinks(dir, links);
      ensureAssetLinks(dir, links);
      assert.ok(existsSync(join(dir, 'data', 'file.json')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('send command exceptions', () => {
  it('runSendSqsCommand throws when queueUrl is missing', async () => {
    await assert.rejects(
      () => runSendSqsCommand('sender', { cwd: join(repoRoot, 'tests/fixtures/no-queue-config') }),
      /queueUrl is required/,
    );
  });

  it('runSendSnsCommand throws when topicArn is missing', async () => {
    const fixtureCwd = join(repoRoot, 'tests/fixtures/no-aws-config');
    await assert.rejects(
      () => runSendSnsCommand('plain', { cwd: fixtureCwd }),
      /topicArn is required/,
    );
  });

  it('runSendSqsCommand throws when queueUrl is missing on no-aws config', async () => {
    const fixtureCwd = join(repoRoot, 'tests/fixtures/no-aws-config');
    await assert.rejects(
      () => runSendSqsCommand('plain', { cwd: fixtureCwd }),
      /queueUrl is required/,
    );
  });
});

describe('listenSqsQueue exceptions', () => {
  it('throws when queueUrl is missing from function config', async () => {
    await assert.rejects(
      () =>
        listenSqsQueue({
          fn: { ...plainFn, aws: {} },
          cwd: repoRoot,
          once: true,
        }),
      /queueUrl is required/,
    );
  });
});

describe('AWS send/publish response exceptions', () => {
  it('sendSqsMessage throws when SDK returns no MessageId', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamkit-mock-sqs-'));
    try {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'mock-consumer', type: 'module' }),
      );
      mkdirSync(join(dir, 'node_modules', '@aws-sdk', 'client-sqs'), { recursive: true });
      writeFileSync(
        join(dir, 'node_modules', '@aws-sdk', 'client-sqs', 'package.json'),
        JSON.stringify({ name: '@aws-sdk/client-sqs', type: 'module', exports: './index.mjs' }),
      );
      writeFileSync(
        join(dir, 'node_modules', '@aws-sdk', 'client-sqs', 'index.mjs'),
        `export class SQSClient { constructor() {} send() { return Promise.resolve({}); } }
export class SendMessageCommand { constructor(input) { this.input = input; } }`,
      );

      await assert.rejects(
        () =>
          sendSqsMessage({
            queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/demo',
            region: 'us-east-1',
            cwd: dir,
            message: 'hi',
          }),
        /no MessageId returned/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('publishSnsMessage throws when SDK returns no MessageId', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamkit-mock-sns-'));
    try {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'mock-consumer', type: 'module' }),
      );
      mkdirSync(join(dir, 'node_modules', '@aws-sdk', 'client-sns'), { recursive: true });
      writeFileSync(
        join(dir, 'node_modules', '@aws-sdk', 'client-sns', 'package.json'),
        JSON.stringify({ name: '@aws-sdk/client-sns', type: 'module', exports: './index.mjs' }),
      );
      writeFileSync(
        join(dir, 'node_modules', '@aws-sdk', 'client-sns', 'index.mjs'),
        `export class SNSClient { constructor() {} send() { return Promise.resolve({}); } }
export class PublishCommand { constructor(input) { this.input = input; } }`,
      );

      await assert.rejects(
        () =>
          publishSnsMessage({
            topicArn: 'arn:aws:sns:us-east-1:123456789012:topic',
            region: 'us-east-1',
            cwd: dir,
            message: 'hi',
          }),
        /no MessageId returned/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('scheduled and eventbridge builders', () => {
  it('buildScheduledEvent sets region and schedule metadata', () => {
    const event = buildScheduledEvent({ job: 'cleanup' }, 'us-east-1');
    assert.equal(event.region, 'us-east-1');
    assert.equal(event.source, 'aws.events');
    assert.deepEqual(event.detail, {});
  });

  it('buildEventBridgeEvent uses detail payload', () => {
    const event = buildEventBridgeEvent({ userId: '42' }, 'eu-central-1');
    assert.equal(event.account, '000000000000');
    assert.deepEqual(event.detail, { userId: '42' });
  });
});

describe('test command exceptions', () => {
  it('rejects malformed --env values', async () => {
    const { runTestCommand } = await import('../dist/commands/test.js');
    await assert.rejects(
      () =>
        runTestCommand('plain', {
          cwd: join(repoRoot, 'tests/fixtures/no-aws-config'),
          env: ['NOT_VALID'],
        }),
      /Invalid --env value/,
    );
  });
});

describe('project-env edge cases', () => {
  it('strips custom AWS endpoints when real AKIA credentials are set', async () => {
    const { stripCustomAwsEndpointsIfRealCredentials } = await import(
      '../dist/config/project-env.js'
    );
    const previous = {
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL,
    };
    process.env.AWS_ACCESS_KEY_ID = 'AKIATESTKEY';
    process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
    try {
      stripCustomAwsEndpointsIfRealCredentials();
      assert.equal(process.env.AWS_ENDPOINT_URL, undefined);
    } finally {
      if (previous.AWS_ACCESS_KEY_ID === undefined) {
        delete process.env.AWS_ACCESS_KEY_ID;
      } else {
        process.env.AWS_ACCESS_KEY_ID = previous.AWS_ACCESS_KEY_ID;
      }
      if (previous.AWS_ENDPOINT_URL === undefined) {
        delete process.env.AWS_ENDPOINT_URL;
      } else {
        process.env.AWS_ENDPOINT_URL = previous.AWS_ENDPOINT_URL;
      }
    }
  });
});

describe('handler export edge cases', () => {
  it('loads handler from wrong-export fixture via extractHandler path', () => {
    assert.throws(
      () => extractHandler({ handler: 'not-a-function' }),
      /HandlerLoadError/,
    );
  });
});
