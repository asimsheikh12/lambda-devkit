import { defineConfig } from 'aws-lambda-devkit';

/**
 * TypeScript config — hover any field for docs and autocomplete.
 * Requires: npm install -D aws-lambda-devkit tsx
 */
export default defineConfig({
  // defaults: {
  //   runtime: 'nodejs20.x',
  //   memorySize: 512,
  //   timeout: 30,
  //   logFormat: 'text',
  //   aws: { region: process.env.AWS_REGION ?? 'us-east-1' },
  // },

  // assetLinks: [{ path: 'contracts', target: 'src/contracts' }],

  functions: [
    {
      name: 'worker',
      entry: './src/lambda/handler.js',
      trigger: 'sqs',
      // test: { data: { orderId: 'ord_local_1' } },
      // aws: { queueUrl: process.env.WORKER_QUEUE_URL },
    },
  ],
});
