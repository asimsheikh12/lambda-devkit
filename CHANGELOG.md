# Changelog

All notable changes to **aws-lambda-devkit** are documented in this file.

## [0.1.5] - 2026-07-01

### Fixed

- **`lamkit listen --no-delete` and `--no-extend-visibility`** — Commander negated flags now map correctly (`delete`, `extendVisibility`); messages are no longer deleted when `--no-delete` is set
- **Duplicate handler logs during `listen`** — application logs no longer print twice (live stdout + `START`/`END` block)
- **`listen` exit code on partial batch** — exits `0` when some messages succeed; exits `1` only when all messages in a batch fail (use `--strict-failures` for CI-style strictness)
- **`listen` missing `queueUrl`** — fails fast with a clear error before loading the AWS SDK

### Added

#### CLI flags

- `lamkit test --parallel` — with `--all`, invoke functions concurrently (skipped when `--env`, `--reload`, `--cold`, or `--inspect` is set)
- `lamkit test --raw-logs` — skip console capture for faster invokes
- `lamkit test --reload-config` — bypass in-memory config cache
- `lamkit listen --raw-logs` — skip console capture in the listen loop
- `lamkit listen --strict-failures` — exit `1` when any message in a poll batch fails
- `--reload-config` on `list`, `config`, and `send` commands

#### Configuration

- `functions[].aws.attributeNames` and `functions[].aws.messageAttributeNames` — control SQS `ReceiveMessage` payload size during `listen`

#### Performance

- Lazy-load CLI commands (faster startup for `list`, `config`, etc.)
- Cache AWS SDK peer imports, parsed config (by file mtime), and asset-link checks
- SQS `DeleteMessageBatch` and `ChangeMessageVisibilityBatch` during `listen`
- Config import uses stable `?v={mtime}` instead of busting cache on every load

### Changed

- Published tarball no longer includes source maps (smaller install, ~0.18 MB unpacked)
- `package.json` sets `"sideEffects": false` for better tree-shaking in bundlers

### Quality

- Security CI: `npm audit`, ESLint (SonarJS), Dependabot, CodeQL
- 111 unit tests including exception and edge-case coverage (`tests/edge-cases.test.js`)

## [0.1.0] - 2026-06-23

**Initial public release** of `aws-lambda-devkit` — a local development toolkit for Node.js AWS Lambda handlers.

### Added

#### CLI (`lamkit`)

- `init` — scaffold `lamkit.config.js`, `.env.example`, sample event, VS Code launch config
- `test` — invoke handlers locally with AWS-shaped events (no deploy required)
- `list` — show registered functions from config
- `config` — print resolved config (secrets redacted)
- `send sqs` / `send sns` — publish to real dev queues/topics (optional AWS SDK peers)
- `listen` — poll a real SQS queue and run the handler locally

#### Local invoke & events

- Simulated invokes for triggers: `sqs`, `http`, `sns`, `s3`, `eventbridge`, `schedule`
- Plain Node.js handler loading — entry must export `handler` (or default export)
- CloudWatch-style `START` / `END` / `REPORT` log output
- Structured logging via `logFormat: 'json'` (global or per-function)
- Handler module cache with `clearHandlerCache()` / `clearAllHandlerCaches()`
- `lamkit test` flags: `--data`, `--data-file`, `@file`, `--event`, `--batch-size`, `--reload`, `--cold`, `--dry-run`, `--inspect-brk`, `--strict-batch`, `--env`, `--cwd`
- `lamkit listen` flags: `--once`, `--expect-messages`, `--batch-invoke` (default), `--no-batch-invoke`, visibility timeout extension

#### Configuration

- Config loader for `lamkit.config.{js,mjs,cjs,ts}`
- Zod validation with readable errors via `formatZodError()`
- `defineConfig()` helper for TypeScript projects
- `defaults` block — shared runtime, memory, timeout, region, log format
- `functions[]` — multiple Lambdas in one config; single-function shorthand at root
- `test.data` — default payload when CLI flags are omitted
- `aws` block per function — `queueUrl`, `topicArn`, `region`, `endpoint`
- **`loadProjectEnv()`** — load parent/shared `.env` files, env aliases, conditional rules, and safe endpoint stripping for real IAM keys
- **`assetLinks`** — symlink dev asset folders (e.g. `contracts` → `src/contracts`) before handler load

#### TypeScript & programmatic API

- Documented public interfaces with JSDoc (`FunctionConfig`, `LamkitConfigInput`, `AssetLink`, `Trigger`, …)
- Hover docs in editors when using `defineConfig()` in `lamkit.config.ts`
- Type-only import path: `aws-lambda-devkit/config`
- Exports: `buildSqsEvent`, `invokeHandler`, `ensureAssetLinks`, `parseConfig`, `loadProjectEnv`, and related helpers

#### AWS (optional)

- SQS send and long-poll listen via `@aws-sdk/client-sqs` peer
- SNS publish via `@aws-sdk/client-sns` peer
- FIFO queue support (`MessageGroupId`, `MessageDeduplicationId`)
- Custom endpoint via `aws.endpoint` (LocalStack, private gateways)
- SQS `MessageAttributes` preserved when building events from polled messages

#### Documentation & templates

- User guides in `docs/`: getting started, commands, configuration, recipes (22 scenarios), troubleshooting
- `templates/lamkit.config.js` and `templates/lamkit.config.ts`
- `templates/events/sample.json`, `.env.example`, `.vscode/launch.json`

#### Quality

- Unit tests for event builders, invoke pipeline, config loading, asset links, and SQS helpers

### Notes

- Complements SAM, CDK, and SST — does **not** deploy Lambdas or create AWS resources
- Default install: 4 runtime dependencies (`zod`, `commander`, `picocolors`, `@types/aws-lambda`)
- Optional peers: `@aws-sdk/client-sqs`, `@aws-sdk/client-sns`, `tsx`
- Requires Node.js 20+
