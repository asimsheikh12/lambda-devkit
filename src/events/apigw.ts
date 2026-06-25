import { serializePayload } from './util.js';

export const defaultHttpData = { message: 'hello from lamkit' };

export function buildApiGatewayEvent(data: unknown) {
  const body = serializePayload(data ?? defaultHttpData);

  return {
    resource: '/local',
    path: '/local',
    httpMethod: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: 'localhost',
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '000000000000',
      apiId: 'local',
      authorizer: {},
      domainName: 'localhost',
      domainPrefix: 'local',
      extendedRequestId: 'local-extended-request-id',
      httpMethod: 'POST',
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'lamkit',
      },
      path: '/local',
      protocol: 'HTTP/1.1',
      requestId: 'local-request-id',
      requestTime: new Date().toUTCString(),
      requestTimeEpoch: Date.now(),
      resourceId: 'local',
      resourcePath: '/local',
      stage: 'local',
    },
    body,
    isBase64Encoded: false,
  };
}
