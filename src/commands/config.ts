import { loadConfig } from '../config/load.js';
import { maskUrl, redactSecrets, resolveFunction, type MergedFunctionConfig } from '../config/merge.js';

function maskAwsFields(fn: MergedFunctionConfig): MergedFunctionConfig {
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
  options: { reloadConfig?: boolean } = {},
): Promise<number> {
  const config = await loadConfig(cwd, options.reloadConfig ? { reload: true } : undefined);
  const fn = resolveFunction(config, functionName);

  const output = redactSecrets(maskAwsFields(fn));

  console.log(JSON.stringify(output, null, 2));
  return 0;
}
