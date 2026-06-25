import { randomUUID } from 'node:crypto';
import { serializePayload } from '../events/util.js';
import { importSqsSdk, loadSqsClient } from './clients.js';

export type SendSqsOptions = {
  queueUrl: string;
  region: string;
  cwd?: string;
  endpoint?: string;
  data?: unknown;
  message?: string;
};

export function buildSqsSendInput(options: {
  queueUrl: string;
  body: string;
  deduplicationId?: string;
}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    QueueUrl: options.queueUrl,
    MessageBody: options.body,
  };

  if (options.queueUrl.endsWith('.fifo')) {
    input.MessageGroupId = 'lamkit-default';
    input.MessageDeduplicationId = options.deduplicationId ?? randomUUID();
  }

  return input;
}

export async function sendSqsMessage(options: SendSqsOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const { SendMessageCommand } = (await importSqsSdk(cwd)) as {
    SendMessageCommand: new (input: unknown) => unknown;
  };
  const client = (await loadSqsClient(options.region, cwd, options.endpoint)) as {
    send(command: unknown): Promise<{ MessageId?: string }>;
  };
  const body =
    options.message ?? serializePayload(options.data ?? { message: 'hello from lamkit' });

  const input = buildSqsSendInput({ queueUrl: options.queueUrl, body });

  const response = (await client.send(new SendMessageCommand(input))) as { MessageId?: string };

  if (!response.MessageId) {
    throw new Error('SendMessage succeeded but no MessageId returned');
  }

  return response.MessageId;
}
