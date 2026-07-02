export default {
  functions: [
    {
      name: 'plain',
      entry: '../plain-handler/handler.js',
      trigger: 'sqs',
    },
  ],
};
