import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSqsSendInput } from '../dist/aws/sqs-send.js';
import { countBatchItemFailures } from '../dist/aws/batch-response.js';
import {
  createVisibilityHeartbeat,
  resolveVisibilityExtensionSeconds,
} from '../dist/aws/sqs-visibility.js';
import {
  buildSqsEventFromMessages,
  isMessageFailed,
  processSqsMessages,
} from '../dist/aws/sqs-process.js';
import { loadEnvFile } from '../dist/config/env.js';
import { parseConfig } from '../dist/config/schema.js';
import { mergeConfig } from '../dist/config/merge.js';
import { resolveListenExitCode, resolveListenCommandFlags } from '../dist/commands/listen.js';
import { resolveTestExitCode } from '../dist/commands/test.js';
import { loadRawConfig } from '../dist/config/load.js';
import { buildApiGatewayEvent } from '../dist/events/apigw.js';
import { buildEventForTrigger } from '../dist/events/index.js';
import { buildS3Event } from '../dist/events/s3.js';
import { buildSnsEvent } from '../dist/events/sns.js';
import { buildSqsEvent, buildSqsRecords } from '../dist/events/sqs.js';
import {
  buildSqsRecordFromAwsMessage,
  mapAwsMessageAttributes,
  queueArnFromUrl,
} from '../dist/events/sqs-record.js';
import { importPeerFromConsumer, MissingPeerError } from '../dist/peer-resolve.js';
import { resolvePayload, readPayloadFile } from '../dist/util/payload.js';
import { invokeHandler, InvokeTimeoutError } from '../dist/runtime/invoke.js';
import { createContext } from '../dist/runtime/context.js';
import { resetColdStart, setInitDurationMs } from '../dist/runtime/context.js';
import { clearAllHandlerCaches, clearHandlerCache, loadHandler } from '../dist/runtime/loader.js';

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

describe('buildSqsEvent', () => {
  it('builds a single record by default', () => {
    const event = buildSqsEvent({ hello: 'world' }, 'eu-west-1');
    assert.equal(event.Records.length, 1);
    assert.equal(event.Records[0].awsRegion, 'eu-west-1');
    assert.equal(JSON.parse(event.Records[0].body).hello, 'world');
  });

  it('builds multiple records with batchSize', () => {
    const event = buildSqsEvent({ id: 1 }, 'us-east-1', 3);
    assert.equal(event.Records.length, 3);
    const ids = new Set(event.Records.map((record) => record.messageId));
    assert.equal(ids.size, 3);
  });

  it('uses queueArn when provided', () => {
    const arn = 'arn:aws:sqs:us-east-1:123456789012:my-queue.fifo';
    const event = buildSqsEvent({ id: 1 }, 'us-east-1', 1, arn);
    assert.equal(event.Records[0].eventSourceARN, arn);
  });

  it('maps array payloads to one record each', () => {
    const records = buildSqsRecords([{ a: 1 }, { b: 2 }], { region: 'us-east-1' });
    assert.equal(records.length, 2);
    assert.deepEqual(JSON.parse(records[0].body), { a: 1 });
    assert.deepEqual(JSON.parse(records[1].body), { b: 2 });
  });
});

describe('buildEventForTrigger queueArn', () => {
  it('derives queueArn from config queueUrl in test flow', () => {
    const queueUrl = 'http://localhost:4566/000000000000/demo.fifo';
    const arn = queueArnFromUrl(queueUrl, 'us-east-1');
    const event = buildEventForTrigger('sqs', { x: 1 }, { region: 'us-east-1', queueArn: arn });
    assert.equal(event.Records[0].eventSourceARN, arn);
  });
});

describe('mapAwsMessageAttributes', () => {
  it('maps SDK PascalCase attributes to Lambda event shape', () => {
    const mapped = mapAwsMessageAttributes({
      route: { StringValue: 'mint', DataType: 'String' },
      flags: { StringListValues: ['a', 'b'], DataType: 'String.Array' },
    });

    assert.equal(mapped.route.stringValue, 'mint');
    assert.equal(mapped.route.dataType, 'String');
    assert.deepEqual(mapped.flags.stringListValues, ['a', 'b']);
  });
});

describe('buildSqsRecordFromAwsMessage', () => {
  it('includes message attributes on listen records', () => {
    const record = buildSqsRecordFromAwsMessage(
      {
        MessageId: 'msg-1',
        Body: '{"ok":true}',
        MessageAttributes: {
          op: { StringValue: 'VERIFY', DataType: 'String' },
        },
      },
      'arn:aws:sqs:us-east-1:000000000000:queue',
      'us-east-1',
    );

    assert.equal(record.messageId, 'msg-1');
    assert.equal(record.messageAttributes.op.stringValue, 'VERIFY');
  });
});

describe('resolvePayload', () => {
  it('parses inline JSON data', () => {
    assert.deepEqual(resolvePayload({ data: '{"x":1}' }), { x: 1 });
  });

  it('supports @file shorthand', () => {
    const payload = resolvePayload({ data: '@tests/fixtures/payload.json' });
    assert.deepEqual(payload, { operation: 'TEST' });
  });
});

describe('readPayloadFile', () => {
  it('resolves relative paths against cwd', () => {
    const event = readPayloadFile('tests/fixtures/event.json', repoRoot);
    assert.equal(event.Records[0].messageId, 'fixture-event');
  });
});

describe('parseConfig aws.endpoint', () => {
  it('accepts optional endpoint in defaults and function aws block', () => {
    const config = parseConfig({
      defaults: {
        aws: { endpoint: 'http://localhost:4566' },
      },
      functions: [
        {
          name: 'demo',
          entry: './handler.js',
          aws: { queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/demo.fifo' },
        },
      ],
    });

    const merged = mergeConfig(config);
    assert.equal(merged.defaults.aws.endpoint, 'http://localhost:4566');
    assert.equal(merged.functions[0].aws.endpoint, 'http://localhost:4566');
  });
});

describe('mergeConfig logFormat', () => {
  it('allows per-function logFormat override', () => {
    const merged = mergeConfig({
      defaults: { logFormat: 'text' },
      functions: [{ name: 'json-fn', entry: './handler.js', logFormat: 'json' }],
    });

    assert.equal(merged.defaults.logFormat, 'text');
    assert.equal(merged.functions[0].logFormat, 'json');
  });
});

describe('invokeHandler', () => {
  it('resolves synchronous return values', async () => {
    const handler = () => ({ ok: true });
    const result = await invokeHandler(handler, {}, plainFn, {
      context: createContext(plainFn),
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.result, { ok: true });
  });

  it('returns exit-worthy failure on thrown errors', async () => {
    const handler = async () => {
      throw new Error('boom');
    };
    const result = await invokeHandler(handler, {}, plainFn, {
      context: createContext(plainFn),
    });

    assert.equal(result.success, false);
    assert.equal(result.error?.message, 'boom');
  });

  it('resolves callback-style handlers', async () => {
    const handler = (_event, _context, callback) => {
      callback(null, { via: 'callback' });
    };
    const result = await invokeHandler(handler, {}, plainFn, {
      context: createContext(plainFn),
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.result, { via: 'callback' });
  });

  it('times out when the handler never settles', async () => {
    const context = createContext(plainFn);
    context.getRemainingTimeInMillis = () => 30;

    const handler = () => new Promise(() => {});
    const result = await invokeHandler(handler, {}, plainFn, { context });

    assert.equal(result.success, false);
    assert.ok(result.error instanceof InvokeTimeoutError);
  });

  it('emits JSON structured logs when logFormat is json', async () => {
    const jsonFn = { ...plainFn, logFormat: 'json' };
    const handler = async () => {
      console.log('hello');
      return 'ok';
    };
    const result = await invokeHandler(handler, {}, jsonFn, {
      context: createContext(jsonFn),
    });

    const start = JSON.parse(result.logs[0]);
    assert.equal(start.type, 'platform.start');
    assert.equal(start.record.requestId, result.requestId);

    const appLog = JSON.parse(result.logs[1]);
    assert.equal(appLog.type, 'platform.log');
    assert.equal(appLog.record.message, 'hello');

    const report = JSON.parse(result.logs[result.logs.length - 1]);
    assert.equal(report.type, 'platform.report');
    assert.equal(report.record.durationMs, result.durationMs);
  });

  it('skips console capture when rawLogs is enabled', async () => {
    const handler = async () => {
      console.log('direct');
      return 'ok';
    };
    const result = await invokeHandler(handler, {}, plainFn, {
      context: createContext(plainFn),
      rawLogs: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.applicationLogs.length, 0);
    assert.ok(result.logs.some((line) => line.startsWith('START RequestId:')));
    assert.ok(result.logs.some((line) => line.startsWith('REPORT RequestId:')));
  });
});

describe('cold start init duration', () => {
  it('surfaces recorded init duration in REPORT logs', async () => {
    resetColdStart();
    setInitDurationMs(42);

    const handler = async () => 'ok';
    const result = await invokeHandler(handler, {}, plainFn, {
      context: createContext(plainFn),
    });

    const report = result.logs.find((line) => line.startsWith('REPORT'));
    assert.ok(report?.includes('Init Duration: 42.00 ms'));
  });
});

describe('handler cache', () => {
  it('returns the same handler instance on repeated loads', async () => {
    clearAllHandlerCaches();
    const first = await loadHandler(plainFn, repoRoot);
    const second = await loadHandler(plainFn, repoRoot);
    assert.equal(first, second);
  });

  it('clearHandlerCache is an alias for clearAllHandlerCaches', () => {
    assert.equal(clearHandlerCache, clearAllHandlerCaches);
  });

  it('reload option reloads handler without error', async () => {
    clearAllHandlerCaches();
    await loadHandler(plainFn, repoRoot);
    const reloaded = await loadHandler(plainFn, repoRoot, { reload: true });
    assert.equal(typeof reloaded, 'function');
  });
});

describe('buildSqsSendInput', () => {
  it('adds FIFO fields for .fifo queue URLs', () => {
    const input = buildSqsSendInput({
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/demo.fifo',
      body: '{"x":1}',
      deduplicationId: 'dedup-1',
    });

    assert.equal(input.MessageGroupId, 'lamkit-default');
    assert.equal(input.MessageDeduplicationId, 'dedup-1');
  });

  it('omits FIFO fields for standard queues', () => {
    const input = buildSqsSendInput({
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/demo',
      body: '{}',
    });

    assert.equal(input.MessageGroupId, undefined);
    assert.equal(input.MessageDeduplicationId, undefined);
  });
});

describe('loadEnvFile', () => {
  it('parses quoted values and inline comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lamkit-env-'));
    const envKey = `LAMKIT_ENV_TEST_${Date.now()}`;
    const commentKey = `LAMKIT_ENV_COMMENT_${Date.now()}`;

    try {
      writeFileSync(
        join(dir, '.env'),
        `${envKey}="bar baz"\n# full-line comment\n${commentKey}=ok # inline comment\n`,
      );

      const previous = process.env[envKey];
      const previousComment = process.env[commentKey];
      delete process.env[envKey];
      delete process.env[commentKey];

      loadEnvFile(dir);

      assert.equal(process.env[envKey], 'bar baz');
      assert.equal(process.env[commentKey], 'ok');

      if (previous === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = previous;
      }

      if (previousComment === undefined) {
        delete process.env[commentKey];
      } else {
        process.env[commentKey] = previousComment;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('importPeerFromConsumer', () => {
  it('throws MissingPeerError for missing optional peers', async () => {
    await assert.rejects(
      () => importPeerFromConsumer(repoRoot, '@lamkit-definitely-missing-peer', 'unit test'),
      (error) => error instanceof MissingPeerError,
    );
  });
});

describe('resolveListenExitCode', () => {
  it('returns 1 when --expect-messages and poll was empty', () => {
    assert.equal(
      resolveListenExitCode({ failures: 0, messagesReceived: 0, processed: 0 }, { expectMessages: true }),
      1,
    );
  });

  it('returns 0 when messages were received', () => {
    assert.equal(
      resolveListenExitCode({ failures: 0, messagesReceived: 2, processed: 2 }, { expectMessages: true }),
      0,
    );
  });

  it('returns 0 on partial batch failure by default', () => {
    assert.equal(
      resolveListenExitCode({ failures: 1, messagesReceived: 3, processed: 2 }, { expectMessages: false }),
      0,
    );
  });

  it('returns 1 when all messages failed', () => {
    assert.equal(
      resolveListenExitCode({ failures: 2, messagesReceived: 2, processed: 0 }, { expectMessages: false }),
      1,
    );
  });

  it('returns 1 on partial failure with --strict-failures', () => {
    assert.equal(
      resolveListenExitCode(
        { failures: 1, messagesReceived: 3, processed: 2 },
        { strictFailures: true },
      ),
      1,
    );
  });
});

describe('resolveListenCommandFlags', () => {
  it('maps Commander negated listen flags', () => {
    assert.deepEqual(resolveListenCommandFlags({ delete: false, extendVisibility: false, batchInvoke: false }), {
      deleteOnSuccess: false,
      extendVisibility: false,
      batchInvoke: false,
    });
  });

  it('defaults delete, visibility extension, and batch invoke to true', () => {
    assert.deepEqual(resolveListenCommandFlags({}), {
      deleteOnSuccess: true,
      extendVisibility: true,
      batchInvoke: true,
    });
  });
});

describe('processSqsMessages', () => {
  it('batch-invoke delivers all records in one event', async () => {
    let invokeCount = 0;
    const handler = async (event) => {
      invokeCount += 1;
      assert.equal(event.Records.length, 2);
      return { ok: true };
    };

    const result = await processSqsMessages({
      messages: [
        { MessageId: 'msg-1', ReceiptHandle: 'rh-1', Body: '{"a":1}' },
        { MessageId: 'msg-2', ReceiptHandle: 'rh-2', Body: '{"b":2}' },
      ],
      handler,
      fn: plainFn,
      queueArn: 'arn:aws:sqs:us-east-1:000000000000:queue',
      region: 'us-east-1',
      batchInvoke: true,
      deleteOnSuccess: false,
    });

    assert.equal(invokeCount, 1);
    assert.equal(result.processed, 2);
    assert.equal(result.failures, 0);
    assert.equal(result.messagesReceived, 2);
  });

  it('counts handler failures for listen exit semantics', async () => {
    const handler = async () => {
      throw new Error('handler failed');
    };

    const result = await processSqsMessages({
      messages: [{ MessageId: 'msg-fail', ReceiptHandle: 'rh-fail', Body: '{}' }],
      handler,
      fn: plainFn,
      queueArn: 'arn:aws:sqs:us-east-1:000000000000:queue',
      region: 'us-east-1',
      batchInvoke: false,
      deleteOnSuccess: false,
    });

    assert.equal(result.failures, 1);
    assert.equal(result.processed, 0);
  });

  it('batch-deletes successful messages in one callback', async () => {
    const handler = async (event) => ({ ok: event.Records.length });
    const deletedBatches = [];

    const result = await processSqsMessages({
      messages: [
        { MessageId: 'msg-1', ReceiptHandle: 'rh-1', Body: '{}' },
        { MessageId: 'msg-2', ReceiptHandle: 'rh-2', Body: '{}' },
      ],
      handler,
      fn: plainFn,
      queueArn: 'arn:aws:sqs:us-east-1:000000000000:queue',
      region: 'us-east-1',
      batchInvoke: true,
      deleteOnSuccess: true,
      deleteMessages: async (handles) => {
        deletedBatches.push(handles);
      },
    });

    assert.equal(result.processed, 2);
    assert.equal(deletedBatches.length, 1);
    assert.deepEqual(deletedBatches[0], ['rh-1', 'rh-2']);
  });

  it('detects partial batch failures via batchItemFailures', () => {
    assert.equal(
      isMessageFailed(
        {
          success: true,
          result: { batchItemFailures: [{ itemIdentifier: 'msg-1' }] },
        },
        'msg-1',
      ),
      true,
    );
    assert.equal(
      isMessageFailed(
        {
          success: true,
          result: { batchItemFailures: [{ itemIdentifier: 'msg-1' }] },
        },
        'msg-2',
      ),
      false,
    );
  });
});

describe('buildSqsEventFromMessages', () => {
  it('maps each message to a record', () => {
    const event = buildSqsEventFromMessages(
      [
        { MessageId: 'a', Body: '{"x":1}' },
        { MessageId: 'b', Body: '{"y":2}' },
      ],
      'arn:aws:sqs:us-east-1:000000000000:queue',
      'us-east-1',
    );

    assert.equal(event.Records.length, 2);
    assert.equal(event.Records[0].messageId, 'a');
    assert.equal(event.Records[1].messageId, 'b');
  });
});

describe('event builders', () => {
  it('builds API Gateway HTTP events', () => {
    const event = buildApiGatewayEvent({ orderId: '42' });
    assert.equal(event.httpMethod, 'POST');
    assert.deepEqual(JSON.parse(event.body), { orderId: '42' });
  });

  it('builds SNS events with message payload', () => {
    const event = buildSnsEvent({ action: 'notify' }, 'eu-west-1');
    assert.equal(event.Records[0].EventSource, 'aws:sns');
    assert.deepEqual(JSON.parse(event.Records[0].Sns.Message), { action: 'notify' });
    assert.equal(event.Records[0].Sns.TopicArn, 'arn:aws:sns:eu-west-1:000000000000:local-topic');
  });

  it('builds S3 events with bucket and key', () => {
    const event = buildS3Event({ bucket: 'uploads', key: 'orders/1.json' }, { region: 'us-west-2' });
    assert.equal(event.Records[0].eventSource, 'aws:s3');
    assert.equal(event.Records[0].s3.bucket.name, 'uploads');
    assert.equal(event.Records[0].s3.object.key, 'orders/1.json');
    assert.equal(event.Records[0].awsRegion, 'us-west-2');
  });

  it('builds events for http and sns triggers', () => {
    const http = buildEventForTrigger('http', { ping: true });
    assert.equal(http.httpMethod, 'POST');

    const sns = buildEventForTrigger('sns', { ping: true }, { region: 'us-east-1' });
    assert.equal(sns.Records[0].EventSource, 'aws:sns');
  });
});

describe('resolveTestExitCode', () => {
  it('returns 1 for batchItemFailures when --strict-batch is set', () => {
    const result = {
      success: true,
      result: { batchItemFailures: [{ itemIdentifier: 'a' }] },
    };
    assert.equal(resolveTestExitCode(result, { strictBatch: true }), 1);
    assert.equal(resolveTestExitCode(result, { strictBatch: false }), 0);
  });

  it('countBatchItemFailures matches result shape', () => {
    assert.equal(countBatchItemFailures({ batchItemFailures: [{ itemIdentifier: 'x' }] }), 1);
    assert.equal(countBatchItemFailures({ ok: true }), 0);
  });
});

describe('sqs visibility', () => {
  it('extends visibility to at least handler timeout plus buffer', () => {
    assert.equal(resolveVisibilityExtensionSeconds(30, 30), 60);
    assert.equal(resolveVisibilityExtensionSeconds(120, 30), 150);
  });

  it('heartbeats visibility extension for active receipt handles', async () => {
    const calls = [];
    const heartbeat = createVisibilityHeartbeat({
      visibilitySeconds: 60,
      extendVisibility: async (handles, seconds) => {
        calls.push({ handles: [...handles], seconds });
      },
    });

    await heartbeat.start(['rh-1', 'rh-2']);
    heartbeat.stop();

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].handles, ['rh-1', 'rh-2']);
    assert.equal(calls[0].seconds, 60);
  });
});

describe('lamkit.config.ts loader', () => {
  it('loads TypeScript config files when tsx is available', async () => {
    const config = await loadRawConfig(join(repoRoot, 'tests/fixtures/ts-config'));
    assert.equal(config.functions[0].name, 'from-ts');
  });
});

describe('loadProjectEnv', () => {
  it('loads env files, applies aliases and rules', async () => {
    const { loadProjectEnv } = await import('../dist/config/project-env.js');
    const dir = mkdtempSync(join(tmpdir(), 'lamkit-env-'));
    const envPath = join(dir, 'app.env');
    writeFileSync(
      envPath,
      'DATABASE_NAME=my-db\nsslOn=true\nETHEREUM_BRIDGE_CONTRACT_ADDRESS=0xabc\n',
    );

    const previous = { ...process.env };
    try {
      delete process.env.DB_NAME;
      delete process.env.DB_SSL;
      delete process.env.ETHEREUM_BRIDGE_CONTRACT;
      delete process.env.LAMKIT_ENV_LOADED;

      loadProjectEnv({
        cwd: dir,
        files: ['./app.env'],
        skipDotenv: true,
        aliases: {
          DATABASE_NAME: 'DB_NAME',
          ETHEREUM_BRIDGE_CONTRACT_ADDRESS: 'ETHEREUM_BRIDGE_CONTRACT',
        },
        rules: [{ when: { sslOn: 'true' }, set: { DB_SSL: 'true' } }],
        stripCustomEndpointForRealAws: false,
      });

      assert.equal(process.env.DB_NAME, 'my-db');
      assert.equal(process.env.DB_SSL, 'true');
      assert.equal(process.env.ETHEREUM_BRIDGE_CONTRACT, '0xabc');
      assert.equal(process.env.LAMKIT_ENV_LOADED, '1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) {
          delete process.env[key];
        }
      }
      Object.assign(process.env, previous);
    }
  });
});

describe('ensureAssetLinks', () => {
  it('creates a symlink when the expected path is missing', async () => {
    const { ensureAssetLinks } = await import('../dist/runtime/asset-links.js');
    const { existsSync, mkdirSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'lamkit-assets-'));
    const targetDir = join(dir, 'src', 'abis');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'contract.json'), '{"ok":true}');

    try {
      ensureAssetLinks(dir, [{ path: 'abis', target: 'src/abis' }]);
      assert.ok(existsSync(join(dir, 'abis', 'contract.json')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses assetLinks in config', () => {
    const config = parseConfig({
      assetLinks: [{ path: 'abis', target: 'src/abis' }],
      functions: [{ name: 'fn', entry: './handler.js' }],
    });
    assert.deepEqual(config.assetLinks, [{ path: 'abis', target: 'src/abis' }]);
  });
});
