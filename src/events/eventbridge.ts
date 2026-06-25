import { randomUUID } from 'node:crypto';

export const defaultEventBridgeData = { source: 'lamkit.local', action: 'test' };

export function buildEventBridgeEvent(data: unknown, region = 'us-east-1') {
  const detail =
    data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : (defaultEventBridgeData as Record<string, unknown>);

  return {
    version: '0',
    id: randomUUID(),
    'detail-type': 'lamkit.local',
    source: 'lamkit.local',
    account: '000000000000',
    time: new Date().toISOString(),
    region,
    resources: [],
    detail,
  };
}
