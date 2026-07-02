import type { MergedFunctionConfig } from '../config/merge.js';
import { loadHandler } from '../runtime/loader.js';
import { clearAllHandlerCaches } from '../runtime/clear-caches.js';
import {
  createVisibilityHeartbeat,
  resolveVisibilityExtensionSeconds,
} from './sqs-visibility.js';
import { importSqsSdk, loadSqsClient, type SqsClientLike } from './clients.js';
import {
  processSqsMessages,
  queueArnFromUrl,
  type ListenResult,
  type SqsMessage,
} from './sqs-process.js';

export type { ListenResult, SqsMessage } from './sqs-process.js';
export {
  buildSqsEventFromMessage,
  buildSqsEventFromMessages,
  countBatchItemFailures,
  isMessageFailed,
  processSqsMessages,
  queueArnFromUrl,
} from './sqs-process.js';

export type ListenOptions = {
  fn: MergedFunctionConfig;
  cwd?: string;
  batchSize?: number;
  batchInvoke?: boolean;
  deleteOnSuccess?: boolean;
  once?: boolean;
  reload?: boolean;
  extendVisibility?: boolean;
  rawLogs?: boolean;
  onMessage?: (messageId: string, status: 'success' | 'failure') => void;
};

type SqsCommandCtors = {
  ReceiveMessageCommand: new (input: unknown) => unknown;
  DeleteMessageCommand: new (input: unknown) => unknown;
  DeleteMessageBatchCommand: new (input: unknown) => unknown;
  ChangeMessageVisibilityCommand: new (input: unknown) => unknown;
  ChangeMessageVisibilityBatchCommand: new (input: unknown) => unknown;
  GetQueueAttributesCommand: new (input: unknown) => unknown;
};

const SQS_BATCH_LIMIT = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function fetchQueueVisibilitySeconds(
  client: SqsClientLike,
  queueUrl: string,
  GetQueueAttributesCommand: SqsCommandCtors['GetQueueAttributesCommand'],
  extendVisibility: boolean,
): Promise<number> {
  if (!extendVisibility) {
    return 30;
  }

  try {
    const attrs = await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['VisibilityTimeout'],
      }),
    );
    return Number(attrs.Attributes?.VisibilityTimeout ?? 30);
  } catch {
    return 30;
  }
}

async function extendVisibilityForHandles(
  client: SqsClientLike,
  queueUrl: string,
  receiptHandles: string[],
  seconds: number,
  commands: Pick<
    SqsCommandCtors,
    'ChangeMessageVisibilityCommand' | 'ChangeMessageVisibilityBatchCommand'
  >,
): Promise<void> {
  if (receiptHandles.length === 0) {
    return;
  }

  if (receiptHandles.length === 1) {
    await client.send(
      new commands.ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandles[0],
        VisibilityTimeout: seconds,
      }),
    );
    return;
  }

  for (const batch of chunk(receiptHandles, SQS_BATCH_LIMIT)) {
    await client.send(
      new commands.ChangeMessageVisibilityBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((ReceiptHandle, index) => ({
          Id: String(index),
          ReceiptHandle,
          VisibilityTimeout: seconds,
        })),
      }),
    );
  }
}

function createListenVisibilityHeartbeat(
  extendVisibility: boolean,
  visibilitySeconds: number,
  client: SqsClientLike,
  queueUrl: string,
  commands: Pick<
    SqsCommandCtors,
    'ChangeMessageVisibilityCommand' | 'ChangeMessageVisibilityBatchCommand'
  >,
) {
  if (!extendVisibility) {
    return undefined;
  }

  return createVisibilityHeartbeat({
    visibilitySeconds,
    extendVisibility: async (receiptHandles, seconds) => {
      await extendVisibilityForHandles(client, queueUrl, receiptHandles, seconds, commands);
    },
  });
}

async function deleteMessagesFromQueue(
  client: SqsClientLike,
  queueUrl: string,
  receiptHandles: string[],
  commands: Pick<SqsCommandCtors, 'DeleteMessageCommand' | 'DeleteMessageBatchCommand'>,
): Promise<void> {
  if (receiptHandles.length === 0) {
    return;
  }

  if (receiptHandles.length === 1) {
    await client.send(
      new commands.DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandles[0],
      }),
    );
    return;
  }

  for (const batch of chunk(receiptHandles, SQS_BATCH_LIMIT)) {
    await client.send(
      new commands.DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((ReceiptHandle, index) => ({
          Id: String(index),
          ReceiptHandle,
        })),
      }),
    );
  }
}

function resolveReceiveAttributeNames(fn: MergedFunctionConfig): {
  messageAttributeNames: string[];
  attributeNames: string[];
} {
  return {
    messageAttributeNames: fn.aws.messageAttributeNames ?? ['All'],
    attributeNames: fn.aws.attributeNames ?? ['All'],
  };
}

async function runListenPollLoop(
  options: ListenOptions,
  ctx: {
    client: SqsClientLike;
    queueUrl: string;
    queueArn: string;
    handler: Awaited<ReturnType<typeof loadHandler>>;
    commands: SqsCommandCtors;
    batchSize: number;
    batchInvoke: boolean;
    deleteOnSuccess: boolean;
    visibilityHeartbeat: ReturnType<typeof createVisibilityHeartbeat> | undefined;
    receiveAttributeNames: ReturnType<typeof resolveReceiveAttributeNames>;
  },
): Promise<ListenResult> {
  const { ReceiveMessageCommand } = ctx.commands;
  let running = true;
  const stop = () => {
    running = false;
  };

  let processed = 0;
  let failures = 0;
  let messagesReceived = 0;

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    while (running) {
      const response = await ctx.client.send(
        new ReceiveMessageCommand({
          QueueUrl: ctx.queueUrl,
          MaxNumberOfMessages: ctx.batchSize,
          WaitTimeSeconds: 20,
          MessageAttributeNames: ctx.receiveAttributeNames.messageAttributeNames,
          AttributeNames: ctx.receiveAttributeNames.attributeNames,
        }),
      );

      const messages = (response.Messages ?? []) as SqsMessage[];
      if (messages.length === 0) {
        if (options.once) {
          break;
        }
        continue;
      }

      const batchResult = await processSqsMessages({
        messages,
        handler: ctx.handler,
        fn: options.fn,
        queueArn: ctx.queueArn,
        region: options.fn.region,
        batchInvoke: ctx.batchInvoke,
        deleteOnSuccess: ctx.deleteOnSuccess,
        rawLogs: options.rawLogs,
        captureOnly: !options.rawLogs,
        deleteMessages: async (receiptHandles) => {
          await deleteMessagesFromQueue(
            ctx.client,
            ctx.queueUrl,
            receiptHandles,
            ctx.commands,
          );
        },
        onMessage: options.onMessage,
        visibilityHeartbeat: ctx.visibilityHeartbeat,
      });

      processed += batchResult.processed;
      failures += batchResult.failures;
      messagesReceived += batchResult.messagesReceived;

      for (const line of batchResult.logs) {
        console.log(line);
      }

      if (!running || options.once) {
        break;
      }
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    ctx.visibilityHeartbeat?.stop();
  }

  return { processed, failures, messagesReceived };
}

export async function listenSqsQueue(options: ListenOptions): Promise<ListenResult> {
  const cwd = options.cwd ?? process.cwd();
  const queueUrl = options.fn.aws.queueUrl;

  if (!queueUrl) {
    throw new Error(
      'queueUrl is required. Set functions[].aws.queueUrl in lamkit.config.js or pass --queue-url',
    );
  }

  if (options.reload) {
    clearAllHandlerCaches();
  }

  const sdk = await importSqsSdk(cwd);
  const {
    ReceiveMessageCommand,
    DeleteMessageCommand,
    DeleteMessageBatchCommand,
    ChangeMessageVisibilityCommand,
    ChangeMessageVisibilityBatchCommand,
    GetQueueAttributesCommand,
  } = sdk as SqsCommandCtors;
  const client = await loadSqsClient(
    options.fn.region,
    cwd,
    options.fn.aws.endpoint,
    sdk,
  );

  const batchSize = options.batchSize ?? 10;
  const deleteOnSuccess = options.deleteOnSuccess ?? true;
  const batchInvoke = options.batchInvoke ?? true;
  const extendVisibility = options.extendVisibility ?? true;
  const handler = await loadHandler(options.fn, cwd, { reload: options.reload });
  const queueArn = queueArnFromUrl(queueUrl, options.fn.region);

  const queueVisibilitySeconds = await fetchQueueVisibilitySeconds(
    client,
    queueUrl,
    GetQueueAttributesCommand,
    extendVisibility,
  );

  const visibilitySeconds = resolveVisibilityExtensionSeconds(
    options.fn.timeout,
    queueVisibilitySeconds,
  );

  const visibilityCommands = {
    ChangeMessageVisibilityCommand,
    ChangeMessageVisibilityBatchCommand,
  };

  const visibilityHeartbeat = createListenVisibilityHeartbeat(
    extendVisibility,
    visibilitySeconds,
    client,
    queueUrl,
    visibilityCommands,
  );

  return runListenPollLoop(options, {
    client,
    queueUrl,
    queueArn,
    handler,
    commands: {
      ReceiveMessageCommand,
      DeleteMessageCommand,
      DeleteMessageBatchCommand,
      ChangeMessageVisibilityCommand,
      ChangeMessageVisibilityBatchCommand,
      GetQueueAttributesCommand,
    },
    batchSize,
    batchInvoke,
    deleteOnSuccess,
    visibilityHeartbeat,
    receiveAttributeNames: resolveReceiveAttributeNames(options.fn),
  });
}
