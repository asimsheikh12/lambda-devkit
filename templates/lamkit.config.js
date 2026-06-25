/**
 * Lambda DevKit — starter config.
 *
 * Docs (after npm install):
 *   node_modules/aws-lambda-devkit/docs/getting-started.md
 *   node_modules/aws-lambda-devkit/docs/commands.md
 *
 * Quick start:
 *   npx lamkit test --data '{"orderId":"1"}'
 *   npx lamkit list
 *   npx lamkit config
 */
export default {
  // defaults: {
  //   runtime: 'nodejs20.x',
  //   memorySize: 512,
  //   timeout: 30,
  //   logFormat: 'text', // or 'json'
  //   aws: { region: process.env.AWS_REGION ?? 'us-east-1' },
  // },

  // Symlink assets before invoke (e.g. dist/ code reads ../../contracts/*.json)
  // assetLinks: [{ path: 'contracts', target: 'src/contracts' }],

  functions: [
    {
      name: 'worker',
      entry: './src/lambda/handler.js', // or './dist/handler.js' after build
      trigger: 'sqs', // sqs | http | sns | s3 | eventbridge | schedule

      // Default payload when you run `lamkit test` with no --data
      // test: { data: { orderId: 'ord_local_1' } },

      // Real dev queue (optional — for `lamkit send sqs` / `lamkit listen`)
      // aws: { queueUrl: process.env.WORKER_QUEUE_URL },
    },
  ],
};
