export default {
  functions: [
    { name: 'alpha', entry: './tests/fixtures/plain-handler/handler.js', trigger: 'sqs' },
    { name: 'beta', entry: './tests/fixtures/plain-handler/handler.js', trigger: 'sqs' },
  ],
};
