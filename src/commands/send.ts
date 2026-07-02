import { resolveConfigFunction } from './config-cmd.js';
import { publishSnsMessage } from '../aws/sns-publish.js';
import { sendSqsMessage } from '../aws/sqs-send.js';
import { resolvePayload } from '../util/payload.js';

export type SendSqsCommandOptions = {
  cwd?: string;
  data?: string;
  dataFile?: string;
  message?: string;
  queueUrl?: string;
  reloadConfig?: boolean;
};

export type SendSnsCommandOptions = {
  cwd?: string;
  data?: string;
  dataFile?: string;
  message?: string;
  topicArn?: string;
  reloadConfig?: boolean;
};

export async function runSendSqsCommand(
  functionName: string,
  options: SendSqsCommandOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const configOptions = options.reloadConfig ? { reload: true } : undefined;
  const { fn } = await resolveConfigFunction(functionName, cwd, configOptions);
  const queueUrl = options.queueUrl ?? fn.aws.queueUrl;

  if (!queueUrl) {
    throw new Error(
      'queueUrl is required. Set functions[].aws.queueUrl in lamkit.config.js or pass --queue-url',
    );
  }

  const payload = resolvePayload({
    data: options.data,
    dataFile: options.dataFile,
    cwd,
  });

  const messageId = await sendSqsMessage({
    queueUrl,
    region: fn.region,
    cwd,
    endpoint: fn.aws.endpoint,
    ...(options.message !== undefined ? { message: options.message } : { data: payload }),
  });

  console.log(`MessageId: ${messageId}`);
  console.log(`Next: lamkit listen ${fn.name}`);
  return 0;
}

export async function runSendSnsCommand(
  functionName: string,
  options: SendSnsCommandOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const configOptions = options.reloadConfig ? { reload: true } : undefined;
  const { fn } = await resolveConfigFunction(functionName, cwd, configOptions);
  const topicArn = options.topicArn ?? fn.aws.topicArn;

  if (!topicArn) {
    throw new Error(
      'topicArn is required. Set functions[].aws.topicArn in lamkit.config.js or pass --topic-arn',
    );
  }

  const payload = resolvePayload({
    data: options.data,
    dataFile: options.dataFile,
    cwd,
  });

  const messageId = await publishSnsMessage({
    topicArn,
    region: fn.region,
    cwd,
    endpoint: fn.aws.endpoint,
    ...(options.message !== undefined ? { message: options.message } : { data: payload }),
  });

  console.log(`MessageId: ${messageId}`);
  console.log(
    `To test a handler: subscribe SQS to this topic, then run lamkit listen <function> on that queue`,
  );
  return 0;
}
