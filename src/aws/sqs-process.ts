import type { MergedFunctionConfig } from '../config/merge.js';
import { isBatchItemFailures } from '../aws/batch-response.js';
import {
  buildSqsRecordFromAwsMessage,
  queueArnFromUrl,
  type AwsSqsMessage,
} from '../events/sqs-record.js';
import type { VisibilityHeartbeat } from '../aws/sqs-visibility.js';
import type { Handler, InvokeResult } from '../runtime/invoke.js';
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
  deleteMessages?: (receiptHandles: string[]) => Promise<void>;
  onMessage?: (messageId: string, status: 'success' | 'failure') => void;
  visibilityHeartbeat?: VisibilityHeartbeat;
  rawLogs?: boolean;
  captureOnly?: boolean;
};

type MessageOutcome = {
  processed: number;
  failures: number;
  receiptHandleToDelete?: string;
};

function resolveMessageOutcome(
  message: SqsMessage,
  result: InvokeResult,
  deleteOnSuccess: boolean,
): MessageOutcome {
  const messageId = message.MessageId ?? 'unknown';
  const failed = isMessageFailed(result, messageId);

  if (failed) {
    return { processed: 0, failures: 1 };
  }

  return {
    processed: 1,
    failures: 0,
    receiptHandleToDelete:
      deleteOnSuccess && message.ReceiptHandle ? message.ReceiptHandle : undefined,
  };
}

async function deleteCollectedReceiptHandles(
  receiptHandles: string[],
  options: Pick<ProcessSqsMessagesOptions, 'deleteMessage' | 'deleteMessages'>,
): Promise<void> {
  if (receiptHandles.length === 0) {
    return;
  }

  if (options.deleteMessages) {
    await options.deleteMessages(receiptHandles);
    return;
  }

  if (options.deleteMessage) {
    for (const receiptHandle of receiptHandles) {
      await options.deleteMessage(receiptHandle);
    }
  }
}

async function processBatchInvoke(
  options: ProcessSqsMessagesOptions,
  deleteOnSuccess: boolean,
): Promise<{ processed: number; failures: number; logs: string[] }> {
  const event = buildSqsEventFromMessages(
    options.messages,
    options.queueArn,
    options.region,
  );
  const result = await invokeHandler(options.handler, event, options.fn, {
    rawLogs: options.rawLogs,
    captureOnly: options.captureOnly,
  });
  const logs = [...result.logs];

  let processed = 0;
  let failures = 0;
  const receiptHandlesToDelete: string[] = [];

  for (const message of options.messages) {
    const messageId = message.MessageId ?? 'unknown';
    const outcome = resolveMessageOutcome(message, result, deleteOnSuccess);
    processed += outcome.processed;
    failures += outcome.failures;

    if (outcome.failures > 0) {
      options.onMessage?.(messageId, 'failure');
    } else {
      options.onMessage?.(messageId, 'success');
      if (outcome.receiptHandleToDelete) {
        receiptHandlesToDelete.push(outcome.receiptHandleToDelete);
      }
    }
  }

  await deleteCollectedReceiptHandles(receiptHandlesToDelete, options);

  return { processed, failures, logs };
}

async function processSequentialInvoke(
  options: ProcessSqsMessagesOptions,
  deleteOnSuccess: boolean,
): Promise<{ processed: number; failures: number; logs: string[] }> {
  const logs: string[] = [];
  let processed = 0;
  let failures = 0;
  const receiptHandlesToDelete: string[] = [];

  for (const message of options.messages) {
    const messageId = message.MessageId ?? 'unknown';
    const event = buildSqsEventFromMessage(message, options.queueArn, options.region);
    const result = await invokeHandler(options.handler, event, options.fn, {
      rawLogs: options.rawLogs,
      captureOnly: options.captureOnly,
    });
    logs.push(...result.logs);

    const outcome = resolveMessageOutcome(message, result, deleteOnSuccess);
    processed += outcome.processed;
    failures += outcome.failures;

    if (outcome.failures > 0) {
      options.onMessage?.(messageId, 'failure');
    } else {
      options.onMessage?.(messageId, 'success');
      if (outcome.receiptHandleToDelete) {
        receiptHandlesToDelete.push(outcome.receiptHandleToDelete);
      }
    }
  }

  await deleteCollectedReceiptHandles(receiptHandlesToDelete, options);

  return { processed, failures, logs };
}

export async function processSqsMessages(
  options: ProcessSqsMessagesOptions,
): Promise<ListenResult & { logs: string[] }> {
  const messagesReceived = options.messages.length;

  if (messagesReceived === 0) {
    return { processed: 0, failures: 0, messagesReceived, logs: [] };
  }

  const deleteOnSuccess = options.deleteOnSuccess ?? true;

  const receiptHandles = options.messages
    .map((message) => message.ReceiptHandle)
    .filter((handle): handle is string => !!handle);

  await options.visibilityHeartbeat?.start(receiptHandles);

  try {
    const outcome = options.batchInvoke
      ? await processBatchInvoke(options, deleteOnSuccess)
      : await processSequentialInvoke(options, deleteOnSuccess);

    return {
      processed: outcome.processed,
      failures: outcome.failures,
      messagesReceived,
      logs: outcome.logs,
    };
  } finally {
    options.visibilityHeartbeat?.stop();
  }
}

export { queueArnFromUrl };
