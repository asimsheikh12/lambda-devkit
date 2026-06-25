# Lambda DevKit

**Test AWS Lambda handlers loacally** — same `handler` export, realistic events, CloudWatch-style logs. Optional real SQS/SNS against a dev account.

| | Name |
|---|------|
| **Repository** | [github.com/asimsheikh12/lambda-devkit](https://github.com/asimsheikh12/lambda-devkit) |
| **npm package** | [`aws-lambda-devkit`](https://www.npmjs.com/package/aws-lambda-devkit) |
| **CLI command** | `lamkit` |
| **Config file** | `lamkit.config.js` (also `.mjs`, `.cjs`, `.ts`) |

![CI](https://github.com/asimsheikh12/lambda-devkit/actions/workflows/ci.yml/badge.svg)

Install as a dev dependency. Complements SAM, CDK, and SST; does not deploy infrastructure.

---

## Documentation

**New here?** Start with the guides below. They use plain language and generic examples only.

| Guide | Description |
|-------|-------------|
| **[Getting started](docs/getting-started.md)** | Install → first successful `lamkit test` (~15 min walkthrough with sample output) |
| **[Commands reference](docs/commands.md)** | Every CLI command and flag with copy-paste examples |
| **[Configuration reference](docs/configuration.md)** | Every config field, `loadProjectEnv`, `assetLinks`, full examples |
| **[Recipes](docs/recipes.md)** | 22 end-to-end setups with layouts, handlers, commands, and expected results |
| **[Troubleshooting](docs/troubleshooting.md)** | Symptom → cause → fix for common errors |

---

## What this package does

| Feature | Command | Needs AWS? |
|---------|---------|------------|
| Simulate invoke | `lamkit test` | No |
| List / inspect config | `lamkit list`, `lamkit config` | No |
| Send message to SQS | `lamkit send sqs` | Yes |
| Poll SQS → local handler | `lamkit listen` | Yes |
| Publish to SNS | `lamkit send sns` | Yes |
| Scaffold project files | `lamkit init` | No |

## What it does not do

- Deploy Lambdas or create queues/topics
- Replace SAM Docker emulation or full IaC workflows
- Require changes inside your production handler code

---

## Five-minute quick start

```bash
npm install -D aws-lambda-devkit
npx lamkit init
cp .env.example .env
```

Create `src/lambda/handler.js`:

```js
export const handler = async (event) => {
  console.log(event);
  return { ok: true };
};
```

`lamkit.config.js` (created by init):

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

Run:

```bash
npx lamkit test --data '{"id":"1"}'
```

You should see `START`, your logs, `END`, and `REPORT` lines.

**Next:** [Getting started](docs/getting-started.md) · [Recipes](docs/recipes.md)

---

## Config at a glance

```js
export default {
  defaults: {
    runtime: 'nodejs20.x',
    memorySize: 512,
    timeout: 30,
    logFormat: 'text',
    aws: { region: 'us-east-1' },
  },
  assetLinks: [
    { path: 'contracts', target: 'src/contracts' },
  ],
  functions: [
    {
      name: 'worker',
      entry: './dist/handler.js',
      trigger: 'sqs',
      aws: { queueUrl: process.env.WORKER_QUEUE_URL },
      test: { data: { id: '1' } },
    },
  ],
};
```

| Block | Purpose |
|-------|---------|
| `defaults` | Shared memory, timeout, region, log format |
| `assetLinks` | Symlink local asset folders before invoke (see [docs](docs/configuration.md#assetlinks)) |
| `functions` | One entry per Lambda; `entry` must export `handler` |

**Monorepo / shared `.env`:** call `loadProjectEnv()` at the top of your config — [example in recipes](docs/recipes.md#recipe-10--monorepo-with-shared-root-env).

Config file names: `lamkit.config.{js,mjs,cjs,ts}` (`.ts` needs optional `tsx` peer).

---

## Commands

### Daily development

```bash
lamkit test [name] --data '{"key":"value"}'
lamkit test --data-file events/payload.json
lamkit test --event events/captured-sqs.json
lamkit test --all
lamkit test --inspect-brk
lamkit list
lamkit config [name]
```

### Real AWS (dev account only)

```bash
npm install -D @aws-sdk/client-sqs   # for send/listen
lamkit send sqs worker --data '{"id":"1"}'
lamkit listen worker --once
```

Use a **dev queue** — do not run `listen` against production while deployed Lambdas consume the same queue.

Full command reference: [Commands](docs/commands.md)

---

## Optional peers

| Install when… | Package |
|---------------|---------|
| TypeScript handler or `lamkit.config.ts` | `tsx` |
| `lamkit send sqs` / `lamkit listen` | `@aws-sdk/client-sqs` |
| `lamkit send sns` | `@aws-sdk/client-sns` |

Default install is **4 small dependencies** (~5 MB): `zod`, `commander`, `picocolors`, `@types/aws-lambda`.

---

## Triggers (simulated `lamkit test`)

| `trigger` | Event type |
|-----------|------------|
| `sqs` | SQS (default) |
| `http` | API Gateway HTTP |
| `sns` | SNS notification |
| `s3` | S3 object event |
| `eventbridge` | EventBridge |
| `schedule` | Scheduled / cron |

Examples per trigger: [Recipes](docs/recipes.md)

---

## vs SAM / SST

| Tool | Best for |
|------|----------|
| **Lambda DevKit** | Fast edit-test loop on Node handlers; optional real SQS poll |
| **SAM** | Docker parity, deploy, broader AWS emulation |
| **SST `dev`** | Live AWS proxy tied to SST stacks |

---

## Programmatic API

```ts
import {
  defineConfig,
  loadProjectEnv,
  buildSqsEvent,
  ensureAssetLinks,
} from 'aws-lambda-devkit';

// Types only (no runtime import):
import type { FunctionConfig, LamkitConfigInput } from 'aws-lambda-devkit/config';
```

Use `defineConfig()` in `lamkit.config.ts` so every config field shows docs on hover. Most users only need the CLI and `lamkit.config.*`.

---

## License

MIT
