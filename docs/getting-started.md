# Getting started

This guide walks you from zero to a working local Lambda invoke. You only need basic Node.js knowledge.

**Time:** about 15 minutes  
**Goal:** run `lamkit test` and see CloudWatch-style logs on your machine

| | |
|---|---|
| Install | `npm install -D aws-lambda-devkit` |
| Run CLI | `npx lamkit test` |
| Import in config | `import { defineConfig } from 'aws-lambda-devkit'` |

---

## What problem does this solve?

In production, AWS Lambda runs your `handler` when an event arrives (SQS message, HTTP request, etc.). To test changes locally you could:

- Write huge JSON event files by hand
- Deploy to dev for every small change
- Run a heavy emulator stack

Lambda DevKit gives you a lighter path:

1. You keep **one** `handler` export — the same code you deploy
2. You add a small **`lamkit.config.js`**
3. You run **`lamkit test --data '{"id":"1"}'`** and lamkit builds a realistic event for you

No changes inside your handler. No deploy required for the basic loop.

---

## What Lambda DevKit does and does not do

| Does | Does not |
|------|----------|
| Invoke `handler` locally | Deploy Lambdas |
| Build SQS / HTTP / SNS shaped events | Create SQS queues or SNS topics |
| Print START / END / REPORT logs | Replace SAM or CDK |
| Optionally send/listen on **existing** dev queues | Modify your production handler code |

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| Node.js | Version 20 or newer (`node -v`) |
| npm | Comes with Node |
| A handler | Or you will create one in Step 3 |

**Optional packages** (install only when needed):

```bash
npm install -D tsx                      # TypeScript handler or lamkit.config.ts
npm install -D @aws-sdk/client-sqs      # lamkit send sqs / lamkit listen
npm install -D @aws-sdk/client-sns      # lamkit send sns
```

---

## Step 1 — Create a project folder

You can use an existing Lambda repo or a new folder:

```bash
mkdir my-lambda-worker
cd my-lambda-worker
npm init -y
```

Your folder will grow to look like this:

```
my-lambda-worker/
├── package.json
├── lamkit.config.js      ← created in Step 2
├── .env                  ← copy from .env.example
├── .env.example
├── events/
│   └── sample.json
└── src/
    └── lambda/
        └── handler.js    ← created in Step 3
```

---

## Step 2 — Install the npm package

Package name on npm is **`aws-lambda-devkit`** (CLI command is still **`lamkit`**).

```bash
npm install -D aws-lambda-devkit
```

Verify the CLI is available:

```bash
npx lamkit --help
```

### Add npm scripts (recommended)

Edit `package.json`:

```json
{
  "name": "my-lambda-worker",
  "type": "module",
  "scripts": {
    "test:lambda": "lamkit test",
    "build": "tsc"
  },
  "devDependencies": {
    "aws-lambda-devkit": "^0.1.0"
  }
}
```

Or scaffold everything with:

```bash
npx lamkit init --yes
```

---

## Step 3 — Scaffold config and env files

```bash
npx lamkit init
cp .env.example .env
```

**`lamkit.config.js`** (created for you):

```js
export default {
  functions: [
    {
      name: 'worker',
      entry: './src/lambda/handler.js',
      trigger: 'sqs',
    },
  ],
};
```

**`.env.example`** (minimal):

```env
AWS_REGION=us-east-1

# Only needed for lamkit send / lamkit listen
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
```

For `lamkit test` alone, `.env` can stay almost empty. Lamkit loads it automatically if present.

---

## Step 4 — Write your handler

Create **`src/lambda/handler.js`**:

```js
/**
 * Production handler — deploy this same file (or its compiled output).
 * Do NOT import aws-lambda-devkit here.
 */
export const handler = async (event, context) => {
  console.log('RequestId:', context.awsRequestId);
  console.log('Record count:', event.Records?.length ?? 0);

  for (const record of event.Records ?? []) {
    const body = JSON.parse(record.body);
    console.log('Processing message:', body);
    // your business logic here
  }

  // SQS handlers often return nothing or partial batch failures:
  // return { batchItemFailures: [{ itemIdentifier: 'message-id' }] };
};
```

**Important rules:**

| Rule | Why |
|------|-----|
| Export must be named `handler` (or default export) | Lamkit looks for this symbol |
| Same file you deploy | Avoids "works locally, different in AWS" |
| No `aws-lambda-devkit` import in handler | Handler stays production-pure |

---

## Step 5 — Run your first test

```bash
npx lamkit test --data '{"orderId":"ord_123","amount":42}'
```

Because you have only one function, the name `worker` is optional.

### What you should see

```
✓ worker (sqs) — 12ms

Logs:
START RequestId: f47ac10b-58cc-4372-a567-0e02b2c3d479 Version: $LATEST
RequestId: f47ac10b-58cc-4372-a567-0e02b2c3d479
Record count: 1
Processing message: { orderId: 'ord_123', amount: 42 }
END RequestId: f47ac10b-58cc-4372-a567-0e02b2c3d479
REPORT RequestId: f47ac10b-58cc-4372-a567-0e02b2c3d479  Duration: 12.00 ms  ...
```

The green `✓` line means lamkit loaded your handler and the invoke finished without an uncaught error.

### What lamkit built for you

With `trigger: 'sqs'`, your `--data` JSON becomes the **body** of an SQS record inside a full `SQSEvent`:

```json
{
  "Records": [
    {
      "messageId": "...",
      "body": "{\"orderId\":\"ord_123\",\"amount\":42}",
      "eventSource": "aws:sqs",
      "awsRegion": "us-east-1"
    }
  ]
}
```

Preview without invoking:

```bash
npx lamkit test --dry-run --data '{"orderId":"ord_123"}'
```

---

## Step 6 — Use a payload file

Create **`events/order-created.json`**:

```json
{
  "orderId": "ord_456",
  "customerId": "cust_789",
  "lines": [{ "sku": "ITEM-1", "qty": 2 }]
}
```

Run:

```bash
npx lamkit test --data-file events/order-created.json
# equivalent:
npx lamkit test --data @events/order-created.json
```

---

## Step 7 — Inspect configuration

```bash
npx lamkit list
npx lamkit config worker
```

Use this when env vars or queue URLs do not resolve the way you expect.

---

## Step 8 — Debug with breakpoints (optional)

### VS Code

`lamkit init` creates **`.vscode/launch.json`**. Open the Run and Debug panel and start **"lamkit test (inspect)"**.

### Terminal

```bash
npx lamkit test --inspect-brk --data '{"orderId":"1"}'
```

Attach your debugger to the Node process (or use Chrome at `chrome://inspect`).

Set a breakpoint inside `handler` and step through your code.

---

## How the pieces fit together

```
┌─────────────────┐
│ lamkit.config.js │  names, entry path, trigger, queue URLs
└────────┬────────┘
         │
┌────────▼────────┐
│  .env (optional) │  AWS_REGION, secrets, queue URLs
└────────┬────────┘
         │
┌────────▼────────┐
│  lamkit test    │  builds event from --data / --event / config
└────────┬────────┘
         │
┌────────▼────────┐
│  your handler   │  export const handler = async (event) => ...
└────────┬────────┘
         │
┌────────▼────────┐
│  console output │  START, your logs, END, REPORT
└─────────────────┘
```

**Offline path (`lamkit test`):** no AWS network calls from lamkit itself.  
**Online path (`send` / `listen`):** optional; see [Recipes — Real SQS](recipes.md#recipe-12--real-sqs-send-then-listen-locally).

---

## When you already have a compiled `dist/` folder

Many teams deploy `./dist/handler.js` after TypeScript compile. Point `entry` at dist:

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

Workflow:

```bash
npm run build
npx lamkit test --data '{"id":"1"}'
```

---

## Default payload in config

Avoid typing `--data` every time:

```js
export default {
  functions: [
    {
      name: 'worker',
      entry: './src/lambda/handler.js',
      trigger: 'sqs',
      test: {
        data: { type: 'PING', source: 'local' },
      },
    },
  ],
};
```

```bash
npx lamkit test
```

---

## Common first-day mistakes

| Mistake | Fix |
|---------|-----|
| `Handler entry not found` | Run `npm run build` or fix `entry` path |
| `must export a named "handler"` | Add `export const handler = ...` |
| Running from wrong directory | `cd` to folder with `lamkit.config.js` or use `--cwd` |
| Empty `event.Records` | Set `trigger: 'sqs'` (default) for queue handlers |
| Expecting lamkit to create queues | You supply existing `queueUrl` for send/listen |
| Handler works in AWS but not locally | Missing `.env` vars or wrong `entry` (src vs dist) |

More fixes: [Troubleshooting](troubleshooting.md)

---

## Where to go next

| I want to… | Read |
|------------|------|
| Every CLI flag with examples | [Commands reference](commands.md) |
| All config fields explained | [Configuration reference](configuration.md) |
| Monorepo, TypeScript, real SQS, HTTP, CI | [Recipes](recipes.md) |
| Fix an error | [Troubleshooting](troubleshooting.md) |
