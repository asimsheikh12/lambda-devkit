import { loadConfig } from '../config/load.js';
import { maskUrl, redactSecrets, resolveFunction } from '../config/merge.js';

function maskAwsFields(fn: Record<string, unknown>): Record<string, unknown> {
  const aws = fn.aws;
  if (!aws || typeof aws !== 'object') {
    return fn;
  }

  const awsRecord = { ...(aws as Record<string, unknown>) };
  if (typeof awsRecord.queueUrl === 'string') {
    awsRecord.queueUrl = maskUrl(awsRecord.queueUrl);
  }
  if (typeof awsRecord.topicArn === 'string') {
    awsRecord.topicArn = maskUrl(awsRecord.topicArn);
  }

  return { ...fn, aws: awsRecord };
}

export async function runConfigCommand(
  functionName: string | undefined,
  cwd: string = process.cwd(),
): Promise<number> {
  const config = await loadConfig(cwd);
  const fn = resolveFunction(config, functionName);

  const output = redactSecrets(
    maskAwsFields(fn as unknown as Record<string, unknown>),
  );

  console.log(JSON.stringify(output, null, 2));
  return 0;
}
