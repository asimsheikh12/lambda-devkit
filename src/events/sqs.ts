import {
  buildSimulatedSqsRecord,
  type SqsRecord,
} from './sqs-record.js';

export type { SqsRecord } from './sqs-record.js';
export { queueArnFromUrl } from './sqs-record.js';

/** AWS `SQSEvent` shape built by `buildSqsEvent()`. */
export type SqsEvent = {
  Records: SqsRecord[];
};

export type BuildSqsEventOptions = {
  /** AWS region embedded in ARNs and attributes. Default: `us-east-1` */
  region?: string;
  /** Duplicate the same body into N records (ignored when `data` is an array). Default: `1` */
  batchSize?: number;
  /** Optional queue ARN on each record. Derived from URL when omitted. */
  queueArn?: string;
};

function serializeBody(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  return JSON.stringify(data ?? {});
}

export function buildSqsRecords(data: unknown, options: BuildSqsEventOptions = {}): SqsRecord[] {
  const region = options.region ?? 'us-east-1';

  if (Array.isArray(data)) {
    return data.map((item) =>
      buildSimulatedSqsRecord({
        body: serializeBody(item),
        region,
        queueArn: options.queueArn,
      }),
    );
  }

  const batchSize = Math.max(1, options.batchSize ?? 1);
  const body = serializeBody(data);

  return Array.from({ length: batchSize }, () =>
    buildSimulatedSqsRecord({ body, region, queueArn: options.queueArn }),
  );
}

export function buildSqsEvent(
  data: unknown,
  region = 'us-east-1',
  batchSize?: number,
  queueArn?: string,
): SqsEvent {
  return {
    Records: buildSqsRecords(data, { region, batchSize, queueArn }),
  };
}

export const defaultSqsData = { message: 'hello from lamkit' };
