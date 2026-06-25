import { importPeerFromConsumer } from '../peer-resolve.js';

export { MissingPeerError } from '../peer-resolve.js';

export async function importSqsSdk(cwd: string = process.cwd()) {
  return importPeerFromConsumer(cwd, '@aws-sdk/client-sqs', 'lamkit send sqs / lamkit listen');
}

export async function importSnsSdk(cwd: string = process.cwd()) {
  return importPeerFromConsumer(cwd, '@aws-sdk/client-sns', 'lamkit send sns');
}

function resolveEndpoint(explicit?: string): string | undefined {
  return explicit ?? process.env.AWS_ENDPOINT_URL;
}

export async function loadSqsClient(region: string, cwd: string = process.cwd(), endpoint?: string) {
  const { SQSClient } = await importSqsSdk(cwd);
  const clientConfig: { region: string; endpoint?: string } = { region };
  const resolvedEndpoint = resolveEndpoint(endpoint);
  if (resolvedEndpoint) {
    clientConfig.endpoint = resolvedEndpoint;
  }
  return new (SQSClient as new (config: unknown) => unknown)(clientConfig);
}

export async function loadSnsClient(region: string, cwd: string = process.cwd(), endpoint?: string) {
  const { SNSClient } = await importSnsSdk(cwd);
  const clientConfig: { region: string; endpoint?: string } = { region };
  const resolvedEndpoint = resolveEndpoint(endpoint);
  if (resolvedEndpoint) {
    clientConfig.endpoint = resolvedEndpoint;
  }
  return new (SNSClient as new (config: unknown) => unknown)(clientConfig);
}
