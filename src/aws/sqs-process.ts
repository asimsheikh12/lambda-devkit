import type { MergedFunctionConfig } from '../config/merge.js';
import { isBatchItemFailures } from '../aws/batch-response.js';
import {
  buildSqsRecordFromAwsMessage,
  queueArnFromUrl,
  type AwsSqsMessage,
} from '../events/sqs-record.js';
import type { VisibilityHeartbeat } from '../aws/sqs-visibility.js';
import type { Handler } from '../runtime/invoke.js';
import { invokeHandler } from '../runtime/invoke.js';

export type SqsMessage = AwsSqsMessage;

export type ListenResult = {
  processed: number;
  failures: number;
  messagesReceived: number;
};

export { isBatchItemFailures, countBatchItemFailures } from '../aws/batch-response.js';

export function buildSqsRecordFromMessage(
  message: SqsMessage,
  queueArn: string,
  region: string,
) {
  return buildSqsRecordFromAwsMessage(message, queueArn, region);
}

export function buildSqsEventFromMessage(
  message: SqsMessage,
  queueArn: string,
  region: string,
) {
  return {
    Records: [buildSqsRecordFromAwsMessage(message, queueArn, region)],
  };
}

export function buildSqsEventFromMessages(
  messages: SqsMessage[],
  queueArn: string,
  region: string,
) {
  return {
    Records: messages.map((message) => buildSqsRecordFromAwsMessage(message, queueArn, region)),
  };
}

export function isMessageFailed(result: { success: boolean; result?: unknown }, messageId: string): boolean {
  if (!result.success) {
    return true;
  }

  if (isBatchItemFailures(result.result)) {
    return result.result.batchItemFailures.some((entry) => entry.itemIdentifier === messageId);
  }

  return false;
}

export type ProcessSqsMessagesOptions = {
  messages: SqsMessage[];
  handler: Handler;
  fn: MergedFunctionConfig;
  queueArn: string;
  region: string;
  batchInvoke?: boolean;
  deleteOnSuccess?: boolean;
  deleteMessage?: (receiptHandle: string) => Promise<void>;
  onMessage?: (messageId: string, status: 'success' | 'failure') => void;
  visibilityHeartbeat?: VisibilityHeartbeat;
};

export async function processSqsMessages(
  options: ProcessSqsMessagesOptions,
): Promise<ListenResult & { logs: string[] }> {
  const deleteOnSuccess = options.deleteOnSuccess ?? true;
  let processed = 0;
  let failures = 0;
  const logs: string[] = [];
  const messagesReceived = options.messages.length;

  if (messagesReceived === 0) {
    return { processed, failures, messagesReceived, logs };
  }

  const receiptHandles = options.messages
    .map((message) => message.ReceiptHandle)
    .filter((handle): handle is string => !!handle);

  await options.visibilityHeartbeat?.start(receiptHandles);

  try {
    if (options.batchInvoke) {
      const event = buildSqsEventFromMessages(
        options.messages,
        options.queueArn,
        options.region,
      );
      const result = await invokeHandler(options.handler, event, options.fn);

      for (const line of result.logs) {
        logs.push(line);
      }

      for (const message of options.messages) {
        const messageId = message.MessageId ?? 'unknown';
        const failed = isMessageFailed(result, messageId);

        if (!failed && deleteOnSuccess && message.ReceiptHandle && options.deleteMessage) {
          await options.deleteMessage(message.ReceiptHandle);
          options.onMessage?.(messageId, 'success');
          processed += 1;
        } else if (failed) {
          options.onMessage?.(messageId, 'failure');
          failures += 1;
        } else if (!failed) {
          options.onMessage?.(messageId, 'success');
          processed += 1;
        }
      }

      return { processed, failures, messagesReceived, logs };
    }

    for (const message of options.messages) {
      const event = buildSqsEventFromMessage(message, options.queueArn, options.region);
      const result = await invokeHandler(options.handler, event, options.fn);
      const messageId = message.MessageId ?? 'unknown';
      const failed = isMessageFailed(result, messageId);

      for (const line of result.logs) {
        logs.push(line);
      }

      if (!failed && deleteOnSuccess && message.ReceiptHandle && options.deleteMessage) {
        await options.deleteMessage(message.ReceiptHandle);
        options.onMessage?.(messageId, 'success');
        processed += 1;
      } else if (failed) {
        options.onMessage?.(messageId, 'failure');
        failures += 1;
      } else if (!failed) {
        options.onMessage?.(messageId, 'success');
        processed += 1;
      }
    }

    return { processed, failures, messagesReceived, logs };
  } finally {
    options.visibilityHeartbeat?.stop();
  }
}

export { queueArnFromUrl };
