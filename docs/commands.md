# Commands reference

Every **`lamkit`** command with examples. Installed via npm package **`aws-lambda-devkit`**.

Run from the directory that contains `lamkit.config.*`, or pass `--cwd`.

Install the CLI:

```bash
npm install -D aws-lambda-devkit
npx lamkit --help
```

---

## `lamkit init`

Creates starter files in the current directory.

```bash
npx lamkit init
npx lamkit init --force          # overwrite existing template files
npx lamkit init --yes            # also add "test:lambda": "lamkit test" to package.json
npx lamkit init --cwd ./packages/worker
```

**Creates:**

| File | Purpose |
|------|---------|
| `lamkit.config.js` | Function definitions |
| `.env.example` | Env var template |
| `.vscode/launch.json` | VS Code debugger config |
| `events/sample.json` | Example JSON payload |

---

## `lamkit list`

Prints all configured functions.

```bash
npx lamkit list
```

**Example output:**

```
NAME    ENTRY                    TRIGGER
-----------------------------------------
worker  ./dist/handler.js        sqs
api     ./dist/http.js           http
```

---

## `lamkit config`

Shows the **merged** config for one function (defaults + overrides). Useful to verify env vars resolved correctly.

```bash
npx lamkit config
npx lamkit config worker
```

Queue URLs and secrets may be truncated or redacted in output.

---

## `lamkit test`

Simulates an AWS event and invokes your handler locally. **No AWS credentials required** unless your handler calls AWS.

### Basic usage

```bash
# Single function in config — name is optional
npx lamkit test --data '{"orderId":"ord_123"}'

# Named function
npx lamkit test worker --data '{"orderId":"ord_123"}'

# All functions in config
npx lamkit test --all
```

### Payload sources (priority order)

When you run `lamkit test`, lamkit picks the event payload like this:

1. `--event path/to/file.json` — full raw event (highest priority)
2. `--data` or `--data-file` — passed to the event builder
3. `functions[].test.data` in config
4. Empty / default sample for the trigger

**Examples:**

```bash
# Inline JSON
npx lamkit test --data '{"type":"ORDER_CREATED","id":"1"}'

# JSON file
npx lamkit test --data-file events/order-created.json

# @file shorthand
npx lamkit test --data @events/order-created.json

# Raw captured SQSEvent (from CloudWatch or AWS samples)
npx lamkit test --event events/captured-sqs.json
```

### SQS-specific flags

```bash
# Five records in one SQSEvent
npx lamkit test --data '{"id":"1"}' --batch-size 5

# Array payload → one record per element
npx lamkit test --data '[{"id":"1"},{"id":"2"}]'
```

### Environment overrides

```bash
npx lamkit test --env LOG_LEVEL=debug --env FEATURE_X=true --data '{"id":"1"}'
```

Only affects that single invoke; does not change `.env`.

### Debugging and inspection

```bash
# Print the built event without calling the handler
npx lamkit test --dry-run --data '{"id":"1"}'

# Node inspector (attach debugger)
npx lamkit test --inspect
npx lamkit test --inspect-brk

# Reload handler after code change
npx lamkit test --reload --data '{"id":"1"}'

# Simulate cold start (Init Duration in REPORT)
npx lamkit test --cold --data '{"id":"1"}'

# Faster invoke (skip console capture)
npx lamkit test --raw-logs --data '{"id":"1"}'

# Invoke all functions in parallel (no --env / --reload / --cold / --inspect)
npx lamkit test --all --parallel

# Reload config module (long-lived processes)
npx lamkit test --reload-config --data '{"id":"1"}'
```

**`--parallel`:** Only applies with `--all`. Ignored when `--env`, `--reload`, `--cold`, or `--inspect` is set.

**`--raw-logs`:** Handler `console.log` goes straight to stdout; no duplicate lines in the `START`/`END` block.

**`--reload-config`:** Re-reads `lamkit.config.*` from disk (also available on `list`, `config`, and `send`).

### Exit codes

```bash
# Exit 1 if handler returns SQS batchItemFailures
npx lamkit test worker --strict-batch --data '[{"id":"1"}]'
```

| Exit code | Meaning |
|-----------|---------|
| `0` | Handler completed without throw (and strict-batch passed) |
| `1` | Handler threw, timeout, or strict-batch failure |

### Example successful output

```
✓ worker (sqs) — 42ms

Logs:
START RequestId: a1b2c3d4-... Version: $LATEST
Received event: {"Records":[...]}
END RequestId: a1b2c3d4-...
REPORT RequestId: a1b2c3d4-...  Duration: 42.00 ms  Billed Duration: 100 ms  Memory Size: 512 MB  Max Memory Used: 89 MB
```

---

## `lamkit send sqs`

Sends one message to a **real** SQS queue. Requires `@aws-sdk/client-sqs` peer and AWS credentials.

```bash
npm install -D @aws-sdk/client-sqs

npx lamkit send sqs worker --data '{"id":"1"}'
npx lamkit send sqs worker --data-file events/payload.json
npx lamkit send sqs worker --message 'plain text body'
npx lamkit send sqs worker --data '{"id":"1"}' --queue-url 'https://sqs...'
```

FIFO queues (URL ends with `.fifo`): lamkit sets `MessageGroupId` and `MessageDeduplicationId` automatically.

**Example output:**

```
Sent to https://sqs.us-east-1.amazonaws.com/123456789012/dev-worker
MessageId: abc-123-def
Run: lamkit listen worker
```

---

## `lamkit send sns`

Publishes to a **real** SNS topic. Requires `@aws-sdk/client-sns` peer.

```bash
npm install -D @aws-sdk/client-sns

npx lamkit send sns notifier --data '{"event":"USER_SIGNUP"}'
npx lamkit send sns notifier --topic-arn 'arn:aws:sns:us-east-1:123456789012:events'
```

This publishes only — it does not invoke your handler. To test the handler offline, use `lamkit test` with `trigger: 'sns'`.

---

## `lamkit listen`

Long-polls a **real** SQS queue and invokes your **local** handler for each message.

```bash
npm install -D @aws-sdk/client-sqs

# Poll until Ctrl+C
npx lamkit listen worker

# One poll batch, then exit
npx lamkit listen worker --once

# Fail if poll returns zero messages (useful in scripts)
npx lamkit listen worker --once --expect-messages
```

### Common flags

```bash
npx lamkit listen worker --batch-size 5
npx lamkit listen worker --no-batch-invoke    # one invoke per message
npx lamkit listen worker --no-delete          # keep messages on queue (debug only)
npx lamkit listen worker --reload             # reload handler each batch
npx lamkit listen worker --queue-url 'https://sqs...'
npx lamkit listen worker --no-extend-visibility
npx lamkit listen worker --raw-logs              # skip console capture (faster)
npx lamkit listen worker --strict-failures       # exit 1 on any batch failure (CI)
```

### Typical dev loop (two terminals)

**Terminal 1:**

```bash
npx lamkit listen worker
```

**Terminal 2:**

```bash
npx lamkit send sqs worker --data '{"id":"1"}'
```

Use a **dev-only queue**. Pause the deployed Lambda event source mapping while listening, or both consumers will compete for messages.

### Message lifecycle (AWS-aligned)

| Handler result | Queue behavior | Exit code (default) |
|----------------|----------------|---------------------|
| Success | Message deleted | 0 |
| Throw or `batchItemFailures` | Message **not** deleted; becomes visible again after timeout | 0 if other messages in the batch succeeded; 1 if all failed |
| `--no-delete` | Never delete (debug escape hatch) | — |
| `--strict-failures` | Same as above | 1 when any message in the batch fails |

---

## Global options

Most commands accept:

```bash
npx lamkit test worker --cwd /path/to/lambda-package --data '{"id":"1"}'
npx lamkit list --reload-config
```

| Flag | Description |
|------|-------------|
| `--cwd <dir>` | Project root (default: current directory) |
| `--reload-config` | Re-read `lamkit.config.*` from disk (bypass in-memory cache) |

---

## npm scripts (recommended)

```json
{
  "scripts": {
    "test:lambda": "lamkit test",
    "test:lambda:all": "lamkit test --all",
    "listen:worker": "lamkit listen worker",
    "send:worker": "lamkit send sqs worker --data '{\"id\":\"1\"}'"
  }
}
```

```bash
npm run test:lambda -- --data '{"id":"1"}'
```

Arguments after `--` are passed to `lamkit`.
