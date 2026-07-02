import { importPeerFromConsumer } from '../peer-resolve.js';

export { MissingPeerError } from '../peer-resolve.js';

/** Minimal SQS client shape used by lamkit (optional peer — no hard SDK types). */
export type SqsClientLike = {
  send(command: unknown): Promise<{
    MessageId?: string;
    Messages?: Array<Record<string, unknown>>;
    Attributes?: Record<string, string>;
    Successful?: Array<{ Id: string }>;
    Failed?: Array<{ Id: string; Code: string; Message?: string }>;
  }>;
};

/** Minimal SNS client shape used by lamkit (optional peer — no hard SDK types). */
export type SnsClientLike = {
  send(command: unknown): Promise<{ MessageId?: string }>;
};

export type SqsSdkModule = Record<string, unknown>;

export async function importSqsSdk(cwd: string = process.cwd()): Promise<SqsSdkModule> {
  return importPeerFromConsumer(cwd, '@aws-sdk/client-sqs', 'lamkit send sqs / lamkit listen');
}

export async function importSnsSdk(cwd: string = process.cwd()): Promise<SqsSdkModule> {
  return importPeerFromConsumer(cwd, '@aws-sdk/client-sns', 'lamkit send sns');
}

function resolveEndpoint(explicit?: string): string | undefined {
  return explicit ?? process.env.AWS_ENDPOINT_URL;
}

export async function loadSqsClient(
  region: string,
  cwd: string = process.cwd(),
  endpoint?: string,
  sdk?: SqsSdkModule,
): Promise<SqsClientLike> {
  const { SQSClient } = sdk ?? (await importSqsSdk(cwd));
  const clientConfig: { region: string; endpoint?: string } = { region };
  const resolvedEndpoint = resolveEndpoint(endpoint);
  if (resolvedEndpoint) {
    clientConfig.endpoint = resolvedEndpoint;
  }
  return new (SQSClient as new (config: unknown) => SqsClientLike)(clientConfig);
}

export async function loadSnsClient(
  region: string,
  cwd: string = process.cwd(),
  endpoint?: string,
  sdk?: SqsSdkModule,
): Promise<SnsClientLike> {
  const { SNSClient } = sdk ?? (await importSnsSdk(cwd));
  const clientConfig: { region: string; endpoint?: string } = { region };
  const resolvedEndpoint = resolveEndpoint(endpoint);
  if (resolvedEndpoint) {
    clientConfig.endpoint = resolvedEndpoint;
  }
  return new (SNSClient as new (config: unknown) => SnsClientLike)(clientConfig);
}
