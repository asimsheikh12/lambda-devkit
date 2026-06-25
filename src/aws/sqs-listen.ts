import type { MergedFunctionConfig } from '../config/merge.js';
import { loadHandler } from '../runtime/loader.js';
import { clearAllHandlerCaches } from '../runtime/clear-caches.js';
import {
  createVisibilityHeartbeat,
  resolveVisibilityExtensionSeconds,
} from './sqs-visibility.js';
import { importSqsSdk, loadSqsClient } from './clients.js';
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
  onMessage?: (messageId: string, status: 'success' | 'failure') => void;
};

export async function listenSqsQueue(options: ListenOptions): Promise<ListenResult> {
  const cwd = options.cwd ?? process.cwd();

  if (options.reload) {
    clearAllHandlerCaches();
  }

  const { ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand, GetQueueAttributesCommand } =
    (await importSqsSdk(cwd)) as {
      ReceiveMessageCommand: new (input: unknown) => unknown;
      DeleteMessageCommand: new (input: unknown) => unknown;
      ChangeMessageVisibilityCommand: new (input: unknown) => unknown;
      GetQueueAttributesCommand: new (input: unknown) => unknown;
    };
  const client = (await loadSqsClient(
    options.fn.region,
    cwd,
    options.fn.aws.endpoint,
  )) as {
    send(command: unknown): Promise<{
      Messages?: SqsMessage[];
      Attributes?: Record<string, string>;
    }>;
  };
  const queueUrl = options.fn.aws.queueUrl;

  if (!queueUrl) {
    throw new Error(
      'queueUrl is required. Set functions[].aws.queueUrl in lamkit.config.js or pass --queue-url',
    );
  }

  const batchSize = options.batchSize ?? 10;
  const deleteOnSuccess = options.deleteOnSuccess ?? true;
  const batchInvoke = options.batchInvoke ?? true;
  const extendVisibility = options.extendVisibility ?? true;
  const handler = await loadHandler(options.fn, cwd, { reload: options.reload });
  const queueArn = queueArnFromUrl(queueUrl, options.fn.region);

  let queueVisibilitySeconds = 30;
  if (extendVisibility) {
    try {
      const attrs = (await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['VisibilityTimeout'],
        }),
      )) as { Attributes?: Record<string, string> };
      queueVisibilitySeconds = Number(attrs.Attributes?.VisibilityTimeout ?? 30);
    } catch {
      queueVisibilitySeconds = 30;
    }
  }

  const visibilitySeconds = resolveVisibilityExtensionSeconds(
    options.fn.timeout,
    queueVisibilitySeconds,
  );

  const visibilityHeartbeat = extendVisibility
    ? createVisibilityHeartbeat({
        visibilitySeconds,
        extendVisibility: async (receiptHandles, seconds) => {
          await Promise.all(
            receiptHandles.map((receiptHandle) =>
              client.send(
                new ChangeMessageVisibilityCommand({
                  QueueUrl: queueUrl,
                  ReceiptHandle: receiptHandle,
                  VisibilityTimeout: seconds,
                }),
              ),
            ),
          );
        },
      })
    : undefined;

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
      const response = (await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: batchSize,
          WaitTimeSeconds: 20,
          MessageAttributeNames: ['All'],
          AttributeNames: ['All'],
        }),
      )) as { Messages?: SqsMessage[] };

      const messages = response.Messages ?? [];
      if (messages.length === 0) {
        if (options.once) {
          break;
        }
        continue;
      }

      const batchResult = await processSqsMessages({
        messages,
        handler,
        fn: options.fn,
        queueArn,
        region: options.fn.region,
        batchInvoke,
        deleteOnSuccess,
        deleteMessage: async (receiptHandle) => {
          await client.send(
            new DeleteMessageCommand({
              QueueUrl: queueUrl,
              ReceiptHandle: receiptHandle,
            }),
          );
        },
        onMessage: options.onMessage,
        visibilityHeartbeat,
      });

      processed += batchResult.processed;
      failures += batchResult.failures;
      messagesReceived += batchResult.messagesReceived;

      for (const line of batchResult.logs) {
        console.log(line);
      }

      if (!running) {
        break;
      }

      if (options.once) {
        break;
      }
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    visibilityHeartbeat?.stop();
  }

  return { processed, failures, messagesReceived };
}
