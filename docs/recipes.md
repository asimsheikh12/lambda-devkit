# Recipes

Copy-paste **end-to-end** setups. Each recipe includes folder layout, config, handler snippets, commands, and what to expect.

Replace generic names (`worker`, `WORKER_QUEUE_URL`, etc.) with your own.

**Index**

| # | Scenario |
|---|----------|
| [1](#recipe-1--single-sqs-worker-javascript) | Single SQS worker, plain JavaScript |
| [2](#recipe-2--compiled-typescript-dist) | Compiled TypeScript (`dist/`) |
| [3](#recipe-3--typescript-with-tsx-no-build) | TypeScript live via `tsx` |
| [4](#recipe-4--default-payload-in-config) | Default payload in config |
| [5](#recipe-5--payload-from-a-file) | Payload from JSON file |
| [6](#recipe-6--raw-captured-aws-event) | Raw captured AWS event |
| [7](#recipe-7--sqs-batch-multiple-records) | SQS batch (multiple records) |
| [8](#recipe-8--http-api-gateway-handler) | HTTP / API Gateway handler |
| [9](#recipe-9--sns-trigger-simulated) | SNS trigger (simulated) |
| [10](#recipe-10--monorepo-shared-root-env) | Monorepo + shared root `.env` |
| [11](#recipe-11--asset-links-for-contractsjson) | Asset links for `contracts/*.json` |
| [12](#recipe-12--real-sqs-send--listen-loop) | Real SQS send + listen loop |
| [13](#recipe-13--fifo-queue) | FIFO queue |
| [14](#recipe-14--sns-publish-real-aws) | SNS publish (real AWS) |
| [15](#recipe-15--json-structured-logs) | JSON structured logs |
| [16](#recipe-16--debug-with-breakpoints) | Debug with breakpoints |
| [17](#recipe-17--ci-smoke-test) | CI smoke test (no AWS) |
| [18](#recipe-18--sqs-partial-batch-failures) | SQS partial batch failures |
| [19](#recipe-19--multiple-functions) | Multiple functions |
| [20](#recipe-20--custom-aws-endpoint) | Custom AWS-compatible endpoint |
| [21](#recipe-21--per-invoke-env-overrides) | Per-invoke env overrides |
| [22](#recipe-22--reload-after-code-change) | Reload after code change |

---

## Recipe 1 — Single SQS worker (JavaScript)

**Goal:** Fastest possible setup — no TypeScript, no build step.

**Layout:**

```
order-worker/
├── package.json
├── lamkit.config.js
├── .env
└── src/
    └── handler.js
```

**`package.json`:**

```json
{
  "name": "order-worker",
  "type": "module",
  "scripts": {
    "test:lambda": "lamkit test"
  },
  "devDependencies": {
    "aws-lambda-devkit": "^0.1.0"
  }
}
```

**`src/handler.js`:**

```js
export const handler = async (event) => {
  for (const record of event.Records) {
    const order = JSON.parse(record.body);
    console.log('Processing order', order.orderId);
    if (!order.orderId) throw new Error('orderId required');
  }
};
```

**`lamkit.config.js`:**

```js
export default {
  functions: [
    {
      name: 'worker',
      entry: './src/handler.js',
      trigger: 'sqs',
      test: { data: { orderId: 'ord_local_1', amount: 10 } },
    },
  ],
};
```

**Commands:**

```bash
npm install
npx lamkit init    # optional if you already have config
npx lamkit test
npx lamkit test --data '{"orderId":"ord_999","amount":50}'
```

**Expect:** `✓ worker (sqs)` and logs showing your `orderId`.

---

## Recipe 2 — Compiled TypeScript (`dist/`)

**Goal:** Match production — deploy `dist/`, test `dist/`.

**Layout:**

```
order-worker/
├── lamkit.config.js
├── src/handler.ts
├── dist/handler.js      ← npm run build
└── tsconfig.json
```

**`src/handler.ts`:**

```ts
import type { SQSEvent, SQSHandler } from 'aws-lambda';

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    console.log('Typed handler:', body);
  }
};
```

**`lamkit.config.js`:**

```js
export default {
  functions: [
    {
      name: 'worker',
      entry: './dist/handler.js',
      trigger: 'sqs',
    },
  ],
};
```

**Commands:**

```bash
npm run build
npx lamkit test --data '{"orderId":"1"}'
```

**Tip:** Add `"test:lambda": "npm run build && lamkit test"` to run build before every test.

---

## Recipe 3 — TypeScript with `tsx` (no build)

**Goal:** Iterate on `.ts` without compiling each time.

```bash
npm install -D aws-lambda-devkit tsx
```

**`lamkit.config.js`:**

```js
export default {
  functions: [
    {
      name: 'worker',
      entry: './src/handler.ts',
      trigger: 'sqs',
    },
  ],
};
```

```bash
npx lamkit test --data '{"id":"1"}'
```

Lamkit uses the `tsx` peer to import `.ts` directly when `dist/` is missing.

---

## Recipe 4 — Default payload in config

**Goal:** Run `lamkit test` with no CLI arguments.

```js
export default {
  functions: [
    {
      name: 'worker',
      entry: './src/handler.js',
      trigger: 'sqs',
      test: {
        data: {
          type: 'PING',
          timestamp: '2026-01-15T12:00:00Z',
        },
      },
    },
  ],
};
```

```bash
npx lamkit test
```

CLI `--data` still overrides config when provided.

---

## Recipe 5 — Payload from a file

**`events/order-created.json`:**

```json
{
  "orderId": "ord_123",
  "customerId": "cust_456",
  "lines": [
    { "sku": "WIDGET-A", "quantity": 2, "price": 19.99 }
  ]
}
```

```bash
npx lamkit test --data-file events/order-created.json
npx lamkit test --data @events/order-created.json
```

Good for large payloads you do not want inline in the shell.

---

## Recipe 6 — Raw captured AWS event

**Goal:** Test with the **exact** event shape from production.

1. Copy an event from CloudWatch Logs or AWS documentation.
2. Save as **`events/sqs-production-sample.json`** (full `SQSEvent` with `Records` array).
3. Run:

```bash
npx lamkit test --event events/sqs-production-sample.json
```

This skips the event builder — useful when field names or attributes must match production exactly.

---

## Recipe 7 — SQS batch (multiple records)

**Goal:** Test batch handling and partial failure logic.

**Handler example:**

```js
export const handler = async (event) => {
  const failures = [];
  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      if (body.shouldFail) throw new Error('simulated failure');
    } catch {
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
};
```

**Commands:**

```bash
# One payload → 5 records
npx lamkit test --data '{"id":"1"}' --batch-size 5

# Array → one record per element
npx lamkit test --data '[{"id":"1"},{"id":"2"},{"id":"3"}]'

# Fail CI if batchItemFailures returned
npx lamkit test --strict-batch --data '[{"shouldFail":true}]'
```

---

## Recipe 8 — HTTP (API Gateway) handler

**`src/http.js`:**

```js
export const handler = async (event) => {
  const body = event.body ? JSON.parse(event.body) : {};
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ greeting: `Hello, ${body.name ?? 'world'}` }),
  };
};
```

**`lamkit.config.js`:**

```js
export default {
  functions: [
    {
      name: 'api',
      entry: './src/http.js',
      trigger: 'http',
      test: { data: { name: 'Ada' } },
    },
  ],
};
```

```bash
npx lamkit test api
npx lamkit test api --data '{"name":"Bob"}'
```

---

## Recipe 9 — SNS trigger (simulated)

**`lamkit.config.js`:**

```js
export default {
  functions: [
    {
      name: 'subscriber',
      entry: './dist/handler.js',
      trigger: 'sns',
      test: { data: { metric: 'cpu', value: 95, threshold: 90 } },
    },
  ],
};
```

**Handler:**

```js
export const handler = async (event) => {
  for (const record of event.Records) {
    const message = JSON.parse(record.Sns.Message);
    console.log('Alert:', message);
  }
};
```

```bash
npx lamkit test subscriber
```

---

## Recipe 10 — Monorepo with shared root `.env`

**Goal:** Lambda package in `packages/worker/` but secrets in repo root `.env`.

**Layout:**

```
acme-platform/
├── .env
└── packages/
    └── order-worker/
        ├── lamkit.config.mjs
        ├── dist/handler.js
        └── package.json
```

**Root `.env`:**

```env
AWS_REGION=eu-west-1
WORKER_QUEUE_URL=https://sqs.eu-west-1.amazonaws.com/111222333/acme-dev-orders
APP_DB_NAME=orders_dev
APP_DB_PORT=5432
```

**`packages/order-worker/lamkit.config.mjs`:**

```js
import { loadProjectEnv } from 'aws-lambda-devkit';

loadProjectEnv({
  files: ['../../.env'],
  skipDotenv: true,
  aliases: {
    APP_DB_NAME: 'DB_NAME',
    APP_DB_PORT: 'DB_PORT',
  },
});

const region = process.env.AWS_REGION ?? 'eu-west-1';

export default {
  defaults: { aws: { region } },
  functions: [
    {
      name: 'worker',
      entry: './dist/handler.js',
      trigger: 'sqs',
      aws: { queueUrl: process.env.WORKER_QUEUE_URL, region },
    },
  ],
};
```

```bash
cd packages/order-worker
npm install -D aws-lambda-devkit
npx lamkit test --data '{"orderId":"1"}'
```

---

## Recipe 11 — Asset links for `contracts/*.json`

**Goal:** `dist/` code does `require('../../contracts/abi.json')` but files live in `src/contracts/`.

**Layout:**

```
worker/
├── src/contracts/abi.json
├── dist/handler.js
└── lamkit.config.js
```

**`lamkit.config.js`:**

```js
export default {
  assetLinks: [{ path: 'contracts', target: 'src/contracts' }],
  functions: [
    { name: 'worker', entry: './dist/handler.js', trigger: 'sqs' },
  ],
};
```

Lamkit creates `contracts → src/contracts` symlink before invoke if `contracts/` is missing.

---

## Recipe 12 — Real SQS: send then listen locally

**Goal:** End-to-end with a real dev queue; handler runs on your machine.

**Install:**

```bash
npm install -D @aws-sdk/client-sqs
```

**`.env`:**

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
WORKER_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/acme-dev-orders
```

**`lamkit.config.js`:**

```js
export default {
  defaults: { aws: { region: process.env.AWS_REGION } },
  functions: [
    {
      name: 'worker',
      entry: './dist/handler.js',
      trigger: 'sqs',
      aws: { queueUrl: process.env.WORKER_QUEUE_URL },
    },
  ],
};
```

**Terminal 1 — listener:**

```bash
npx lamkit listen worker
```

**Terminal 2 — sender:**

```bash
npx lamkit send sqs worker --data '{"orderId":"live-1"}'
```

**Expect:** Terminal 1 prints `message <id>: success` and your handler logs.

**Safety:** Use a dev-only queue. Disable the deployed Lambda event source mapping while listening.

**One-shot:**

```bash
npx lamkit send sqs worker --data '{"orderId":"1"}'
npx lamkit listen worker --once --expect-messages
```

---

## Recipe 13 — FIFO queue

Same as Recipe 12, but `WORKER_QUEUE_URL` ends with `.fifo`:

```env
WORKER_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/acme-orders.fifo
```

```bash
npx lamkit send sqs worker --data '{"orderId":"1","group":"customer-A"}'
```

Lamkit sets `MessageGroupId` and `MessageDeduplicationId` automatically.

---

## Recipe 14 — SNS publish (real AWS)

```bash
npm install -D @aws-sdk/client-sns
```

```env
EVENTS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:acme-dev-events
```

```js
export default {
  functions: [
    {
      name: 'notifier',
      entry: './dist/handler.js',
      trigger: 'sns',
      aws: { topicArn: process.env.EVENTS_TOPIC_ARN },
    },
  ],
};
```

```bash
npx lamkit send sns notifier --data '{"event":"ORDER_PLACED","orderId":"1"}'
```

To invoke the handler offline with SNS event shape, use `lamkit test` with `trigger: 'sns'`.

---

## Recipe 15 — JSON structured logs

```js
export default {
  defaults: { logFormat: 'json' },
  functions: [
    { name: 'worker', entry: './src/handler.js', trigger: 'sqs' },
  ],
};
```

```bash
npx lamkit test --data '{"id":"1"}' | jq .
```

Each log line is a JSON object — easier for scripts and log aggregators locally.

---

## Recipe 16 — Debug with breakpoints

**VS Code:** Run **"lamkit test (inspect)"** from `.vscode/launch.json` (created by `lamkit init`).

**Terminal:**

```bash
npx lamkit test worker --inspect-brk --data '{"orderId":"1"}'
```

Set breakpoints in your handler, attach debugger, step through code.

---

## Recipe 17 — CI smoke test

**Goal:** GitHub Actions / GitLab CI runs handlers without AWS credentials.

**`package.json`:**

```json
{
  "scripts": {
    "test:lambda": "lamkit test --all"
  }
}
```

**Config** — each function needs `test.data` or handlers must tolerate empty events:

```js
export default {
  functions: [
    {
      name: 'worker',
      entry: './dist/handler.js',
      trigger: 'sqs',
      test: { data: { type: 'CI_PING' } },
    },
  ],
};
```

**CI step:**

```yaml
- run: npm ci
- run: npm run build
- run: npm run test:lambda
```

Handlers that call AWS/DB in CI may need mocks or `--dry-run` only.

---

## Recipe 18 — SQS partial batch failures

```bash
npx lamkit test worker --strict-batch --data '[{"id":"ok"},{"id":"bad"}]'
```

Exit code `1` if handler returns:

```js
return {
  batchItemFailures: [{ itemIdentifier: 'message-id-here' }],
};
```

Useful in shell scripts and CI gates.

---

## Recipe 19 — Multiple functions

```js
export default {
  functions: [
    {
      name: 'orders',
      entry: './dist/orders.js',
      trigger: 'sqs',
      test: { data: { type: 'ORDER' } },
    },
    {
      name: 'billing',
      entry: './dist/billing.js',
      trigger: 'sqs',
      test: { data: { type: 'INVOICE' } },
    },
  ],
};
```

```bash
npx lamkit list
npx lamkit test orders
npx lamkit test billing
npx lamkit test --all
```

---

## Recipe 20 — Custom AWS-compatible endpoint

```env
AWS_ENDPOINT_URL=https://internal-gateway.example.com
AWS_REGION=us-east-1
```

```js
export default {
  defaults: {
    aws: {
      region: process.env.AWS_REGION,
      endpoint: process.env.AWS_ENDPOINT_URL,
    },
  },
  functions: [/* ... */],
};
```

When using real IAM keys (`AKIA*`), `loadProjectEnv()` strips endpoint overrides by default so SDK hits real AWS. Set `stripCustomEndpointForRealAws: false` to keep custom endpoints with real keys.

---

## Recipe 21 — Per-invoke env overrides

```bash
npx lamkit test worker \
  --env FEATURE_NEW_PARSER=true \
  --env LOG_LEVEL=debug \
  --data '{"orderId":"1"}'
```

Does not modify `.env` — only the current process.

---

## Recipe 22 — Reload after code change

During a tight edit-test loop:

```bash
# terminal 1: edit src/handler.js
npx lamkit test worker --reload --data '{"orderId":"1"}'
```

`--reload` bypasses the handler module cache so you see fresh code without restarting the shell.

---

## Picking a recipe

| Your situation | Start with |
|----------------|------------|
| Brand new project | Recipe 1 |
| TypeScript + `tsc` | Recipe 2 |
| Monorepo | Recipe 10 |
| `require('../../contracts/...')` fails | Recipe 11 |
| Test against real dev queue | Recipe 12 |
| GitHub Actions | Recipe 17 |

More detail: [Configuration](configuration.md) · [Commands](commands.md) · [Troubleshooting](troubleshooting.md)
