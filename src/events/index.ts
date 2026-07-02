import type { Trigger } from '../config/schema.js';
import { buildApiGatewayEvent, defaultHttpData } from './apigw.js';
import { buildEventBridgeEvent, defaultEventBridgeData } from './eventbridge.js';
import { buildScheduledEvent } from './schedule.js';
import { buildS3Event, defaultS3Data } from './s3.js';
import { buildSnsEvent, defaultSnsData } from './sns.js';
import { buildSqsEvent, defaultSqsData } from './sqs.js';

export type BuildEventOptions = {
  region?: string;
  s3Key?: string;
  s3Bucket?: string;
  batchSize?: number;
  queueArn?: string;
};

const defaultDataByTrigger: Record<Trigger, unknown> = {
  sqs: defaultSqsData,
  http: defaultHttpData,
  sns: defaultSnsData,
  s3: defaultS3Data,
  eventbridge: defaultEventBridgeData,
  schedule: {},
};

export function getDefaultEventData(trigger: Trigger): unknown {
  return defaultDataByTrigger[trigger];
}

export function buildEventForTrigger(
  trigger: Trigger,
  data?: unknown,
  options: BuildEventOptions = {},
): unknown {
  const region = options.region ?? 'us-east-1';
  const payload = data ?? getDefaultEventData(trigger);

  switch (trigger) {
    case 'sqs':
      return buildSqsEvent(payload, region, options.batchSize, options.queueArn);
    case 'http':
      return buildApiGatewayEvent(payload);
    case 'sns':
      return buildSnsEvent(payload, region);
    case 's3':
      return buildS3Event(payload, {
        region,
        key: options.s3Key,
        bucket: options.s3Bucket,
      });
    case 'eventbridge':
      return buildEventBridgeEvent(payload, region);
    case 'schedule':
      return buildScheduledEvent(payload, region);
    default: {
      const exhaustive: never = trigger;
      throw new Error(`Unknown trigger: ${String(exhaustive)}`);
    }
  }
}

export { buildApiGatewayEvent } from './apigw.js';
export { buildEventBridgeEvent } from './eventbridge.js';
export { buildS3Event } from './s3.js';
export { buildScheduledEvent } from './schedule.js';
export { buildSnsEvent } from './sns.js';
export { buildSqsEvent } from './sqs.js';
