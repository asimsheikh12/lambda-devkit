export function buildScheduledEvent(_data?: unknown, region = 'us-east-1') {
  const time = new Date().toISOString();

  return {
    version: '0',
    id: 'local-schedule-id',
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    account: '000000000000',
    time,
    region,
    resources: [`arn:aws:events:${region}:000000000000:rule/local-schedule`],
    detail: {},
  };
}
