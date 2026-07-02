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
  const sdk = await importSnsSdk(cwd);
  const { PublishCommand } = sdk as {
    PublishCommand: new (input: unknown) => unknown;
  };
  const client = await loadSnsClient(options.region, cwd, options.endpoint, sdk);
  const message =
    options.message ?? serializePayload(options.data ?? { message: 'hello from lamkit' });

  const response = await client.send(
    new PublishCommand({
      TopicArn: options.topicArn,
      Message: message,
    }),
  );

  if (!response.MessageId) {
    throw new Error('Publish succeeded but no MessageId returned');
  }

  return response.MessageId;
}
