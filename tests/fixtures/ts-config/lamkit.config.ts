export default {
  functions: [
    {
      name: 'from-ts',
      entry: './handler.js',
      trigger: 'sqs',
    },
  ],
};
