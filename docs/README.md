# Lambda DevKit documentation

Guides for **[Lambda DevKit](https://github.com/asimsheikh12/lambda-devkit)** — npm package **`aws-lambda-devkit`**, CLI **`lamkit`**.

Complete walkthroughs for integrating the toolkit into your Node.js Lambda project. All examples use generic names (`worker`, `WORKER_QUEUE_URL`, etc.) — copy them and replace with your own paths and env vars.

| Guide | Time | What you will learn |
|-------|------|---------------------|
| [Getting started](getting-started.md) | ~15 min | Install, project layout, first `lamkit test`, what the output means |
| [Commands reference](commands.md) | Reference | Every CLI command and flag with copy-paste examples |
| [Configuration reference](configuration.md) | Reference | Every `lamkit.config.*` field, env loading, asset links |
| [Recipes](recipes.md) | Copy-paste | 22 end-to-end setups (SQS, HTTP, monorepo, real AWS, CI, …) |
| [Troubleshooting](troubleshooting.md) | When stuck | Errors, causes, and step-by-step fixes |

**Package name:** `aws-lambda-devkit`  
**CLI command:** `lamkit`  
**Config file:** `lamkit.config.js` (also `.mjs`, `.cjs`, or `.ts`)

After `npm install -D aws-lambda-devkit`, open guides from:

```
node_modules/aws-lambda-devkit/docs/getting-started.md
```
