import { importSnsSdk, loadSnsClient } from './clients.js';
import { serializePayload } from '../events/util.js';

export type PublishSnsOptions = {
  topicArn: string;
  region: string;
  cwd?: string;
  endpoint?: string;
  data?: unknown;
  message?: string;
};

export async function publishSnsMessage(options: PublishSnsOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const { PublishCommand } = (await importSnsSdk(cwd)) as {
    PublishCommand: new (input: unknown) => unknown;
  };
  const client = (await loadSnsClient(options.region, cwd, options.endpoint)) as {
    send(command: unknown): Promise<{ MessageId?: string }>;
  };
  const message =
    options.message ?? serializePayload(options.data ?? { message: 'hello from lamkit' });

  const response = (await client.send(
    new PublishCommand({
      TopicArn: options.topicArn,
      Message: message,
    }),
  )) as { MessageId?: string };

  if (!response.MessageId) {
    throw new Error('Publish succeeded but no MessageId returned');
  }

  return response.MessageId;
}
