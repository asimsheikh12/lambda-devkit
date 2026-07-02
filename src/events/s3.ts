import { randomUUID } from 'node:crypto';

export type S3EventOptions = {
  bucket?: string;
  key?: string;
  region?: string;
};

export const defaultS3Data = { key: 'sample.json' };

function readStringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function buildS3Event(data: unknown, options: S3EventOptions = {}) {
  const region = options.region ?? 'us-east-1';
  const meta =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const bucket = readStringField(meta.bucket) ?? options.bucket ?? 'local-bucket';
  const key = readStringField(meta.key) ?? options.key ?? defaultS3Data.key;
  const eventTime = new Date().toISOString();

  return {
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: region,
        eventTime,
        eventName: 'ObjectCreated:Put',
        userIdentity: { principalId: 'local:dev' },
        requestParameters: { sourceIPAddress: '127.0.0.1' },
        responseElements: {
          'x-amz-request-id': randomUUID(),
          'x-amz-id-2': 'local-id-2',
        },
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'lamkit-local',
          bucket: {
            name: bucket,
            ownerIdentity: { principalId: 'local:dev' },
            arn: `arn:aws:s3:::${bucket}`,
          },
          object: {
            key,
            size: 0,
            eTag: 'local-etag',
            sequencer: '0',
          },
        },
      },
    ],
  };
}
