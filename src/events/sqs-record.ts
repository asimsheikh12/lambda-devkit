import { randomUUID } from 'node:crypto';

export type SqsRecord = {
  messageId: string;
  receiptHandle: string;
  body: string;
  attributes: Record<string, string>;
  messageAttributes: Record<string, SqsMessageAttributeValue>;
  md5OfBody: string;
  eventSource: 'aws:sqs';
  eventSourceARN: string;
  awsRegion: string;
};

export type SqsMessageAttributeValue = {
  stringValue?: string;
  binaryValue?: string;
  stringListValues?: string[];
  binaryListValues?: string[];
  dataType: string;
};

export type AwsSqsMessageAttribute = {
  StringValue?: string;
  BinaryValue?: string;
  StringListValues?: string[];
  BinaryListValues?: string[];
  DataType?: string;
};

export type AwsSqsMessage = {
  MessageId?: string;
  ReceiptHandle?: string;
  Body?: string;
  Attributes?: Record<string, string>;
  MessageAttributes?: Record<string, AwsSqsMessageAttribute>;
};

const DEFAULT_SYSTEM_ATTRIBUTES: Record<string, string> = {
  ApproximateReceiveCount: '1',
  SenderId: 'local:dev',
};

export function queueArnFromUrl(queueUrl: string, region: string): string {
  try {
    const url = new URL(queueUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const queueName = parts[parts.length - 1] ?? 'local-queue';
    const accountId = parts.length >= 2 ? parts[parts.length - 2]! : '000000000000';
    return `arn:aws:sqs:${region}:${accountId}:${queueName}`;
  } catch {
    return `arn:aws:sqs:${region}:000000000000:local-queue`;
  }
}

export function mapAwsMessageAttributes(
  attributes?: Record<string, AwsSqsMessageAttribute>,
): Record<string, SqsMessageAttributeValue> {
  if (!attributes) {
    return {};
  }

  const mapped: Record<string, SqsMessageAttributeValue> = {};

  for (const [name, value] of Object.entries(attributes)) {
    mapped[name] = {
      ...(value.StringValue !== undefined ? { stringValue: value.StringValue } : {}),
      ...(value.BinaryValue !== undefined ? { binaryValue: value.BinaryValue } : {}),
      ...(value.StringListValues !== undefined
        ? { stringListValues: value.StringListValues }
        : {}),
      ...(value.BinaryListValues !== undefined
        ? { binaryListValues: value.BinaryListValues }
        : {}),
      dataType: value.DataType ?? 'String',
    };
  }

  return mapped;
}

function defaultAttributes(
  overrides?: Record<string, string>,
): Record<string, string> {
  const timestamp = String(Date.now());
  return {
    ...DEFAULT_SYSTEM_ATTRIBUTES,
    SentTimestamp: timestamp,
    ApproximateFirstReceiveTimestamp: timestamp,
    ...overrides,
  };
}

export type BuildSimulatedSqsRecordOptions = {
  body: string;
  region: string;
  queueArn?: string;
  messageId?: string;
  receiptHandle?: string;
};

export function buildSimulatedSqsRecord(options: BuildSimulatedSqsRecordOptions): SqsRecord {
  const messageId = options.messageId ?? randomUUID();

  return {
    messageId,
    receiptHandle: options.receiptHandle ?? `local-receipt-${messageId}`,
    body: options.body,
    attributes: defaultAttributes(),
    messageAttributes: {},
    md5OfBody: 'local-md5',
    eventSource: 'aws:sqs',
    eventSourceARN:
      options.queueArn ?? `arn:aws:sqs:${options.region}:000000000000:local-queue`,
    awsRegion: options.region,
  };
}

export function buildSqsRecordFromAwsMessage(
  message: AwsSqsMessage,
  queueArn: string,
  region: string,
): SqsRecord {
  const messageId = message.MessageId ?? 'unknown';

  return {
    messageId,
    receiptHandle: message.ReceiptHandle ?? '',
    body: message.Body ?? '',
    attributes: defaultAttributes(message.Attributes),
    messageAttributes: mapAwsMessageAttributes(message.MessageAttributes),
    md5OfBody: 'local-md5',
    eventSource: 'aws:sqs',
    eventSourceARN: queueArn,
    awsRegion: region,
  };
}
