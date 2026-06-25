declare module 'tsx/esm/api' {
  export function register(): void;
}

declare module '@aws-sdk/client-sqs' {
  export class SQSClient {
    constructor(config?: unknown);
    send(command: unknown): Promise<unknown>;
  }
  export class SendMessageCommand {
    constructor(input: unknown);
  }
  export class ReceiveMessageCommand {
    constructor(input: unknown);
  }
  export class DeleteMessageCommand {
    constructor(input: unknown);
  }
}

declare module '@aws-sdk/client-sns' {
  export class SNSClient {
    constructor(config?: unknown);
    send(command: unknown): Promise<unknown>;
  }
  export class PublishCommand {
    constructor(input: unknown);
  }
}
