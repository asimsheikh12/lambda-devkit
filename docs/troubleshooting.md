# Troubleshooting

Step-by-step fixes for common problems. Each section: **symptom → cause → fix → verify**.

---

## Quick diagnosis

Run these first from your Lambda package directory (where `lamkit.config.*` lives):

```bash
npx lamkit config          # resolved config + env
npx lamkit list            # registered functions
npx lamkit test --dry-run  # no handler execution — checks paths only
```

If `config` or `list` fails, fix config before testing handlers.

---

## `Cannot find module` for handler entry

**Symptom:**

```
Error: Cannot find module '/path/to/dist/handler.js'
```

**Causes:**

1. `entry` points to `dist/` but you have not built yet.
2. Wrong relative path from config file location.
3. Typo in filename (`handler.js` vs `handlers.js`).

**Fix:**

```bash
# TypeScript project
npm run build
ls -la dist/handler.js

# Or point entry at source and use tsx
# entry: './src/handler.ts'
```

**Verify:**

```bash
npx lamkit test --dry-run worker
```

---

## `Cannot find module '../../contracts/abi.json'`

**Symptom:** Handler loads from `dist/` but JSON/ABI files live under `src/`.

**Cause:** Production layout expects sibling folders next to `dist/`; dev layout keeps assets under `src/`.

**Fix — use `assetLinks` in config:**

```js
export default {
  assetLinks: [{ path: 'contracts', target: 'src/contracts' }],
  functions: [
    { name: 'worker', entry: './dist/handler.js', trigger: 'sqs' },
  ],
};
```

Lamkit creates `contracts → src/contracts` before invoke if `contracts/` does not exist.

**Verify:**

```bash
ls -la contracts    # should be a symlink
npx lamkit test worker
```

**Manual alternative:**

```bash
ln -s src/contracts contracts
```

---

## Wrong or missing environment variables

**Symptom:** Handler works in AWS but fails locally with `undefined` env, connection errors, or wrong region.

**Causes:**

1. `.env` not in the directory you run from.
2. Monorepo: secrets in root `.env`, but lamkit loads only cwd `.env`.
3. Variable names differ between `.env` and handler (`APP_DB_HOST` vs `DB_HOST`).

**Fix — `loadProjectEnv` at top of config:**

```js
import { loadProjectEnv } from 'aws-lambda-devkit';

loadProjectEnv({
  files: ['../../.env'],   // paths relative to config file
  skipDotenv: true,        // do not also load ./.env
  aliases: {
    APP_DB_HOST: 'DB_HOST',
    APP_DB_NAME: 'DB_NAME',
  },
});
```

**Verify:**

```bash
npx lamkit config | grep -E 'DB_|AWS_'
npx lamkit test worker --env LOG_LEVEL=debug
```

**Per-run override without editing files:**

```bash
npx lamkit test worker --env DB_HOST=localhost --data '{}'
```

---

## `lamkit: command not found`

**Symptom:** Shell cannot find `lamkit` after `npm install`.

**Fix:** Use `npx` or an npm script:

```bash
npx lamkit test
# or in package.json:
# "test:lambda": "lamkit test"
```

Install as dev dependency in the **same package** as your config:

```bash
npm install -D aws-lambda-devkit
```

---

## Config file not found

**Symptom:**

```
No lamkit.config.js / .mjs / .ts found
```

**Fix:**

```bash
npx lamkit init
# creates lamkit.config.js + sample handler + events/
```

Supported names: `lamkit.config.js`, `lamkit.config.mjs`, `lamkit.config.ts`, `lamkit.config.cjs`.

Run commands from the directory that contains the config (or pass `--config path/to/lamkit.config.mjs` if your CLI supports it — check `lamkit test --help`).

---

## Handler throws but AWS “works”

**Symptom:** Local test fails; deployed Lambda succeeds with same payload.

**Checklist:**

| Check | What to do |
|-------|------------|
| Event shape | Compare `--event` file vs built event: `lamkit test --dry-run` shows trigger |
| Batch size | AWS may send multiple `Records`; test with `--batch-size 3` |
| Env / secrets | `lamkit config` — compare to Lambda console env |
| IAM / network | Local code may reach RDS/VPC; Lambda uses VPC config |
| Time / IDs | Payload uses real DB IDs in prod, fake IDs locally |

**Capture production event:**

1. Log full `event` in Lambda (temporarily).
2. Save to `events/prod-sample.json`.
3. `npx lamkit test --event events/prod-sample.json`

---

## SQS `listen` receives nothing

**Symptom:** `lamkit listen worker` runs but no messages processed.

**Causes:**

1. Wrong `queueUrl` in config or `.env`.
2. Message sent to a different queue/region/account.
3. Deployed Lambda still consuming messages (race).
4. Empty queue.

**Fix:**

```bash
# Confirm URL
npx lamkit config

# Send then listen (one-shot)
npx lamkit send sqs worker --data '{"ping":true}'
npx lamkit listen worker --once --expect-messages
```

**AWS CLI cross-check:**

```bash
aws sqs get-queue-attributes \
  --queue-url "$WORKER_QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages
```

**Safety:** Pause Lambda event source mapping on dev queues while using `listen`.

---

## `send sqs` / `send sns` fails with credentials

**Symptom:**

```
CredentialsProviderError / UnrecognizedClientException
```

**Fix:**

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# Optional for LocalStack / custom gateway:
# AWS_ENDPOINT_URL=http://localhost:4566
```

Install peer:

```bash
npm install -D @aws-sdk/client-sqs
# and/or
npm install -D @aws-sdk/client-sns
```

**Verify:**

```bash
aws sts get-caller-identity
npx lamkit send sqs worker --data '{"test":true}'
```

---

## FIFO queue errors

**Symptom:**

```
MissingParameter: The request must contain the parameter MessageGroupId
```

**Cause:** Standard send flags used against a `.fifo` queue.

**Fix:** Lamkit auto-sets group/dedup IDs when queue URL ends with `.fifo`. Ensure `queueUrl` in config is the full FIFO URL.

```bash
npx lamkit send sqs worker --data '{"orderId":"1"}'
```

---

## TypeScript: `Unexpected token` or import errors

**Symptom:** Parsing error when `entry` is `.ts`.

**Fix:**

```bash
npm install -D tsx
# entry: './src/handler.ts'
npx lamkit test
```

Or build first and point `entry` at `./dist/handler.js`.

---

## `strict-batch` exits 1 unexpectedly

**Symptom:** Test fails with `--strict-batch` but handler “looks fine”.

**Cause:** Handler returns `batchItemFailures` for one or more records (correct SQS partial failure response).

**Verify:**

```bash
npx lamkit test worker --data '[{"id":"1"},{"id":"2"}]' 
# without --strict-batch — inspect returned batchItemFailures in output
```

Use `--strict-batch` only when you want CI to fail on any partial failure.

---

## Stale code after edits

**Symptom:** You changed handler but test runs old logic.

**Fix:**

```bash
npx lamkit test worker --reload --data '{}'
```

Or rebuild for `dist/`:

```bash
npm run build && npx lamkit test worker
```

---

## `assetLinks` did not create symlink

**Symptom:** Link missing; still get module not found.

**Causes:**

1. `path` already exists as a real directory (Lamkit does not overwrite).
2. `target` path wrong relative to project root.

**Fix:**

```bash
rm -rf contracts          # only if safe — not production data
npx lamkit test --dry-run # triggers asset link setup
ls -la contracts
```

Check `target` exists:

```bash
ls -la src/contracts
```

---

## Custom endpoint hits real AWS (or vice versa)

**Symptom:** `AWS_ENDPOINT_URL` set but SDK calls `amazonaws.com`.

**Cause:** `loadProjectEnv()` strips custom endpoints when it detects real `AKIA*` access keys (safety default).

**Fix:**

```js
loadProjectEnv({
  stripCustomEndpointForRealAws: false,
});
```

Or use test credentials / LocalStack keys with endpoint URL.

---

## Debug checklist (printable)

```
[ ] cd to directory with lamkit.config.*
[ ] npm install && npm run build (if using dist/)
[ ] npx lamkit list
[ ] npx lamkit config
[ ] npx lamkit test --dry-run
[ ] npx lamkit test --data '{...}' or --event file.json
[ ] Compare env to Lambda console
[ ] For real queue: send + listen --once --expect-messages
```

---

## Still stuck?

1. Minimal repro: one handler, one `test.data`, no AWS calls.
2. Add `console.log(JSON.stringify(event, null, 2))` at handler start.
3. Compare with [Getting started](getting-started.md) and matching [Recipe](recipes.md).

Report issues with: lamkit version (`npx lamkit --version`), config (redact secrets), command line, and full error stack.
