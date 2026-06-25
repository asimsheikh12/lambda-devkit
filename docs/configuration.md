# Configuration reference

Everything you can put in **`lamkit.config.js`** (or `.mjs`, `.cjs`, `.ts`). Lamkit reads this file on every command and validates it with clear error messages.

**Tip:** Run `lamkit config worker` after editing to see the merged result.

---

## Where the config file lives

Lamkit searches the current directory (or `--cwd`) for the first match:

1. `lamkit.config.ts`
2. `lamkit.config.js`
3. `lamkit.config.mjs`
4. `lamkit.config.cjs`

```bash
# Run from the config directory
cd my-lambda-worker
npx lamkit test

# Or point at another folder
npx lamkit test --cwd ./packages/worker-service
```

---

## Config file formats

### JavaScript (default)

**`lamkit.config.js`:**

```js
export default {
  functions: [
    { name: 'worker', entry: './dist/handler.js', trigger: 'sqs' },
  ],
};
```

### CommonJS

**`lamkit.config.cjs`:**

```js
module.exports = {
  functions: [
    { name: 'worker', entry: './dist/handler.js', trigger: 'sqs' },
  ],
};
```

### TypeScript

Requires optional peer `tsx`:

```bash
npm install -D tsx
```

**`lamkit.config.ts`:**

```ts
import { defineConfig } from 'aws-lambda-devkit';

export default defineConfig({
  defaults: {
    aws: { region: 'us-east-1' },
  },
  functions: [
    {
      name: 'worker',
      entry: './dist/handler.js',
      trigger: 'sqs',
    },
  ],
});
```

`defineConfig()` wraps your config with full TypeScript types. **Hover any key** (`entry`, `trigger`, `assetLinks`, …) in VS Code / Cursor for field descriptions, examples, and allowed values.

Types are also available without importing runtime code:

```ts
import type { FunctionConfig, LamkitConfigInput } from 'aws-lambda-devkit/config';
```

See also `templates/lamkit.config.ts` in the package (copy after `lamkit init`).

---

## Full config shape

```js
export default {
  // Shared defaults for all functions
  defaults: {
    runtime: 'nodejs20.x',
    memorySize: 512,
    timeout: 30,
    logFormat: 'text',
    tracing: false,
    aws: {
      region: 'us-east-1',
      endpoint: undefined,
    },
  },

  // Optional: symlink local asset folders before invoke
  assetLinks: [
    { path: 'contracts', target: 'src/contracts' },
  ],

  // One object per Lambda you want to test
  functions: [
    {
      name: 'worker',
      entry: './dist/handler.js',
      trigger: 'sqs',
      memorySize: 1024,
      timeout: 120,
      logFormat: 'json',
      test: { data: { id: 'default' } },
      aws: {
        region: 'eu-west-1',
        queueUrl: process.env.WORKER_QUEUE_URL,
        topicArn: process.env.EVENTS_TOPIC_ARN,
        endpoint: undefined,
      },
    },
  ],
};
```

### Single-function shortcut

If you only have one Lambda, you can flatten the config:

```js
export default {
  name: 'worker',
  entry: './src/handler.js',
  trigger: 'sqs',
  test: { data: { id: '1' } },
};
```

Lamkit converts this internally to `functions: [{ name: 'worker', ... }]`. If you omit `name`, it becomes `default`.

---

## `defaults` — shared settings

Apply to every function unless the function overrides the same field.

```js
export default {
  defaults: {
    runtime: 'nodejs20.x',   // shown in logs
    memorySize: 512,         // MB — used in REPORT line
    timeout: 30,             // seconds — handler killed after this
    logFormat: 'text',        // 'text' | 'json'
    tracing: false,          // X-Ray fields in REPORT when true
    aws: {
      region: 'us-east-1',   // event region + SDK default
      endpoint: undefined,   // optional custom endpoint for send/listen
    },
  },
  functions: [/* ... */],
};
```

**Example — JSON logs for all functions:**

```js
export default {
  defaults: { logFormat: 'json' },
  functions: [
    { name: 'worker', entry: './src/handler.js', trigger: 'sqs' },
  ],
};
```

**Example — one function overrides timeout:**

```js
export default {
  defaults: { timeout: 30 },
  functions: [
    {
      name: 'slow-worker',
      entry: './dist/slow.js',
      trigger: 'sqs',
      timeout: 300,
    },
  ],
};
```

| Field | Default if omitted |
|-------|-------------------|
| `runtime` | `nodejs20.x` |
| `memorySize` | `512` |
| `timeout` | `30` |
| `logFormat` | `text` |
| `tracing` | `false` |
| `aws.region` | `process.env.AWS_REGION` → `us-east-1` |

---

## `functions[]` — one entry per Lambda

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | CLI name: `lamkit test worker` |
| `entry` | Yes | Path to module that exports `handler` |
| `trigger` | No | Event builder (`sqs` default) |
| `memorySize` | No | Overrides `defaults.memorySize` |
| `timeout` | No | Overrides `defaults.timeout` |
| `logFormat` | No | Overrides `defaults.logFormat` |
| `test.data` | No | Default `--data` when CLI omits it |
| `aws.*` | No | Queue/topic/region for send, listen, realistic ARNs |

### `entry` — which file to load

| Your setup | Set `entry` to |
|------------|----------------|
| Plain JavaScript | `./src/handler.js` |
| Compiled TypeScript | `./dist/handler.js` (after `npm run build`) |
| TypeScript via tsx | `./src/handler.ts` (requires `tsx` peer) |

Handler module **must** export:

```js
export const handler = async (event, context) => {
  // ...
};
```

### `test.data` — default payload

```js
{
  name: 'worker',
  entry: './src/handler.js',
  trigger: 'sqs',
  test: {
    data: {
      type: 'ORDER_CREATED',
      orderId: 'ord_local_1',
    },
  },
}
```

```bash
npx lamkit test
# same payload as: npx lamkit test --data '{"type":"ORDER_CREATED",...}'
```

CLI `--data` always wins over `test.data`.

---

## `trigger` — event types for `lamkit test`

The `trigger` field tells lamkit how to turn your `--data` JSON into a full AWS event.

### `sqs` (default)

**Config:**

```js
{ name: 'worker', entry: './dist/handler.js', trigger: 'sqs' }
```

**Handler pattern:**

```js
export const handler = async (event) => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    console.log(body);
  }
};
```

**CLI:**

```bash
npx lamkit test --data '{"orderId":"1"}'
npx lamkit test --data '{"orderId":"1"}' --batch-size 3
npx lamkit test --data '[{"a":1},{"a":2}]'
```

**`--data` meaning:** JSON object (or array) stored in `Records[].body` as a string.

If `aws.queueUrl` is set, lamkit also sets a realistic `eventSourceARN` on each record.

---

### `http` (API Gateway)

**Config:**

```js
{ name: 'api', entry: './dist/http.js', trigger: 'http' }
```

**Handler pattern:**

```js
export const handler = async (event) => {
  console.log(event.httpMethod, event.path);
  console.log('Body:', event.body);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
};
```

**CLI:**

```bash
npx lamkit test api --data '{"username":"ada"}'
```

**`--data` meaning:** HTTP request body (lamkit wraps it in an API Gateway proxy event).

---

### `sns`

**Config:**

```js
{ name: 'subscriber', entry: './dist/handler.js', trigger: 'sns' }
```

**CLI:**

```bash
npx lamkit test subscriber --data '{"alert":"cpu high"}'
```

**`--data` meaning:** SNS `Message` string (object is JSON-stringified).

---

### `s3`, `eventbridge`, `schedule`

```js
{ name: 'on-upload', entry: './dist/handler.js', trigger: 's3' }
{ name: 'on-bus', entry: './dist/handler.js', trigger: 'eventbridge' }
{ name: 'cron', entry: './dist/handler.js', trigger: 'schedule' }
```

```bash
npx lamkit test on-upload --data '{"key":"uploads/file.pdf"}'
npx lamkit test on-bus --data '{"orderId":"1","status":"shipped"}'
npx lamkit test cron --data '{}'
```

For full control, skip the builder and use a captured event:

```bash
npx lamkit test worker --event events/captured-from-cloudwatch.json
```

---

## `aws` block — real queues and topics

Only required for **`lamkit send`** and **`lamkit listen`**. Optional for `lamkit test` (improves SQS ARN realism).

```js
export default {
  defaults: {
    aws: { region: 'us-east-1' },
  },
  functions: [
    {
      name: 'worker',
      entry: './dist/handler.js',
      trigger: 'sqs',
      aws: {
        queueUrl: process.env.WORKER_QUEUE_URL,
      },
    },
    {
      name: 'notifier',
      entry: './dist/notify.js',
      trigger: 'sns',
      aws: {
        topicArn: process.env.EVENTS_TOPIC_ARN,
      },
    },
  ],
};
```

**`.env` example:**

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
WORKER_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/dev-worker
EVENTS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:dev-events
```

**Custom endpoint** (private cloud / compatible API):

```js
defaults: {
  aws: {
    region: 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL,
  },
},
```

---

## `assetLinks` — local files your `dist/` code expects

### The problem

Compiled code often loads files relative to its own path:

```
dist/services/connector.js  →  require('../../contracts/abi.json')
                              resolves to  ./contracts/abi.json
```

In your Docker image, `contracts/` is copied next to `dist/`. In git, files may live under `src/contracts/` instead. Local invoke fails with `Cannot find module`.

### The solution

```js
export default {
  assetLinks: [
    { path: 'contracts', target: 'src/contracts' },
    { path: 'email-templates', target: 'src/templates' },
  ],
  functions: [
    { name: 'worker', entry: './dist/handler.js', trigger: 'sqs' },
  ],
};
```

Before `test` or `listen`, lamkit creates a symlink:

```
contracts  →  src/contracts
```

If `contracts/` already exists, lamkit leaves it alone.

| Field | Example | Meaning |
|-------|---------|---------|
| `path` | `contracts` | Where compiled code looks |
| `target` | `src/contracts` | Where files live in dev |

---

## Environment variables

### Auto-loaded `.env`

By default lamkit loads **`.env`** from the project root (same directory as config).

```env
# .env
AWS_REGION=us-east-1
DATABASE_URL=postgres://localhost:5432/app
WORKER_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/dev-worker
LOG_LEVEL=debug
```

Rules:

- `KEY=value` per line
- `# comment`
- Quotes allowed: `KEY="value with spaces"`

**Never commit `.env`** — use `.env.example` with placeholder values.

### `loadProjectEnv()` — monorepos and name mapping

When the Lambda package is in a subfolder and `.env` lives at the repo root:

**Layout:**

```
repo/
├── .env
└── services/
    └── worker/
        ├── lamkit.config.mjs
        └── dist/handler.js
```

**`services/worker/lamkit.config.mjs`:**

```js
import { loadProjectEnv } from 'aws-lambda-devkit';

loadProjectEnv({
  files: ['../../.env'],
  skipDotenv: true,
  aliases: {
    APP_DATABASE_NAME: 'DB_NAME',
    APP_DATABASE_PORT: 'DB_PORT',
    APP_DATABASE_HOST: 'DB_HOST',
  },
  rules: [
    { when: { USE_SSL: 'true' }, set: { DB_SSL: 'true' } },
    { when: { NODE_ENV: 'development' }, set: { LOG_LEVEL: 'debug' } },
  ],
});

const region = process.env.AWS_REGION ?? 'us-east-1';

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

| Option | What it does |
|--------|----------------|
| `files` | Load these env files first (paths relative to config dir) |
| `skipDotenv: true` | Do not load `./.env` inside the worker package |
| `aliases` | If `APP_DATABASE_NAME` is set and `DB_NAME` is not, copy value |
| `rules` | When all `when` keys match, set `set` keys (if not already set) |
| `stripCustomEndpointForRealAws` | Default `true` — strips `AWS_ENDPOINT_URL*` when using real `AKIA*` keys |

Call `loadProjectEnv()` **before** `export default { ... }` so `process.env` is ready when the config object is built.

---

## Payload priority (`lamkit test`)

| Priority | Source |
|----------|--------|
| 1 (highest) | `--event file.json` |
| 2 | `--data` or `--data-file` |
| 3 | `functions[].test.data` |
| 4 | Builder default for trigger |

Example:

```js
// config has test.data: { id: 'from-config' }
npx lamkit test --data '{"id":"from-cli"}'   // uses from-cli
npx lamkit test                              // uses from-config
```

---

## CLI flags (quick reference)

Full examples: [Commands reference](commands.md)

| Flag | Example |
|------|---------|
| `--cwd` | `lamkit test --cwd ./services/worker` |
| `--data` | `lamkit test --data '{"id":"1"}'` |
| `--data-file` | `lamkit test --data-file events/p.json` |
| `--event` | `lamkit test --event events/raw.json` |
| `--batch-size` | `lamkit test --batch-size 5` |
| `--env` | `lamkit test --env KEY=val` |
| `--dry-run` | `lamkit test --dry-run` |
| `--reload` | `lamkit test --reload` |
| `--strict-batch` | `lamkit test --strict-batch` |
| `--queue-url` | `lamkit listen --queue-url 'https://sqs...'` |

---

## Complete production-like example

```js
import { defineConfig, loadProjectEnv } from 'aws-lambda-devkit';

loadProjectEnv({
  files: ['../.env'],
  skipDotenv: true,
  aliases: { SHARED_DB_NAME: 'DB_NAME' },
});

const region = process.env.AWS_REGION ?? 'us-east-1';

export default defineConfig({
  defaults: {
    runtime: 'nodejs20.x',
    memorySize: 512,
    timeout: 30,
    logFormat: 'text',
    aws: { region },
  },
  assetLinks: [
    { path: 'contracts', target: 'src/contracts' },
  ],
  functions: [
    {
      name: 'queue-worker',
      entry: './dist/worker.js',
      trigger: 'sqs',
      timeout: 120,
      memorySize: 1024,
      aws: { queueUrl: process.env.WORKER_QUEUE_URL },
      test: { data: { type: 'ORDER_CREATED', id: 'local-1' } },
    },
    {
      name: 'http-api',
      entry: './dist/api.js',
      trigger: 'http',
      test: { data: { action: 'health' } },
    },
    {
      name: 'sns-handler',
      entry: './dist/events.js',
      trigger: 'sns',
      aws: { topicArn: process.env.EVENTS_TOPIC_ARN },
      test: { data: { event: 'USER_SIGNUP' } },
    },
  ],
});
```

**Verify:**

```bash
npx lamkit list
npx lamkit config queue-worker
npx lamkit test queue-worker
npx lamkit test --all
```

More scenarios: [Recipes](recipes.md)
