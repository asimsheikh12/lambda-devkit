export default {
  functions: [
    {
      name: 'sender',
      entry: './tests/fixtures/plain-handler/handler.js',
      trigger: 'sqs',
      aws: { topicArn: 'arn:aws:sns:us-east-1:123456789012:only-topic' },
    },
  ],
};
