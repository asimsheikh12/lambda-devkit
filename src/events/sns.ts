import { randomUUID } from 'node:crypto';
import { serializePayload } from './util.js';

export const defaultSnsData = { message: 'hello from lamkit' };

export function buildSnsEvent(data: unknown, region = 'us-east-1') {
  const message = serializePayload(data ?? defaultSnsData);
  const messageId = randomUUID();
  const timestamp = new Date().toISOString();

  return {
    Records: [
      {
        EventSource: 'aws:sns',
        EventVersion: '1.0',
        EventSubscriptionArn: `arn:aws:sns:${region}:000000000000:local-topic:local-subscription`,
        Sns: {
          Type: 'Notification',
          MessageId: messageId,
          TopicArn: `arn:aws:sns:${region}:000000000000:local-topic`,
          Subject: 'lamkit-local',
          Message: message,
          Timestamp: timestamp,
          SignatureVersion: '1',
          Signature: 'local-signature',
          SigningCertUrl: 'https://localhost/cert.pem',
          UnsubscribeUrl: 'https://localhost/unsubscribe',
          MessageAttributes: {},
        },
      },
    ],
  };
}
