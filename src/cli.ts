#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';

const packageJson = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../package.json'),
    'utf8',
  ),
) as { version: string };

const program = new Command();

program
  .name('lamkit')
  .description('Local AWS Lambda development toolkit')
  .version(packageJson.version);

program
  .command('test')
  .description('Invoke a Lambda handler locally with a simulated AWS event')
  .argument('[function-name]', 'Function name from lamkit.config.js')
  .option('--cwd <dir>', 'Project directory containing lamkit.config.js')
  .option('--data <json>', 'JSON payload passed to the event builder (supports @file.json)')
  .option('--data-file <file>', 'Read JSON payload from a file')
  .option('--event <file>', 'Path to a JSON event file (bypasses event builder)')
  .option('--batch-size <n>', 'SQS record count for simulated events', (v) => Number(v))
  .option('--env <key=value>', 'Set environment variable for invoke', collect, [])
  .option('--all', 'Invoke every function in config')
  .option('--parallel', 'With --all, invoke functions concurrently (ignored when --env is set)')
  .option('--dry-run', 'Print resolved event without invoking handler')
  .option('--cold', 'Simulate cold start (Init Duration in logs)')
  .option('--reload', 'Reload handler module (bypass cache)')
  .option('--reload-config', 'Reload lamkit.config (bypass config cache)')
  .option('--strict-batch', 'Exit 1 when handler returns batchItemFailures (SQS partial batch)')
  .option('--verbose', 'Print extra invoke diagnostics')
  .option('--no-pretty', 'Disable pretty summary output')
  .option('--raw-logs', 'Skip console capture (faster invoke; handler logs go straight to stdout)')
  .option('--inspect', 'Re-run under node --inspect')
  .option('--inspect-brk', 'Re-run under node --inspect-brk')
  .action(
    async (
      functionName: string | undefined,
      options: {
        cwd?: string;
        data?: string;
        dataFile?: string;
        event?: string;
        batchSize?: number;
        env: string[];
        all?: boolean;
        parallel?: boolean;
        dryRun?: boolean;
        cold?: boolean;
        reload?: boolean;
        reloadConfig?: boolean;
        strictBatch?: boolean;
        verbose?: boolean;
        pretty?: boolean;
        rawLogs?: boolean;
        inspect?: boolean;
        inspectBrk?: boolean;
      },
    ) => {
      try {
        const { runTestCommand } = await import('./commands/test.js');
        const exitCode = await runTestCommand(functionName, {
          cwd: options.cwd,
          data: options.data,
          dataFile: options.dataFile,
          eventPath: options.event,
          batchSize: options.batchSize,
          env: options.env,
          all: options.all,
          parallel: options.parallel,
          dryRun: options.dryRun,
          cold: options.cold,
          reload: options.reload,
          reloadConfig: options.reloadConfig,
          strictBatch: options.strictBatch,
          verbose: options.verbose,
          pretty: options.pretty,
          rawLogs: options.rawLogs,
          inspect: options.inspect,
          inspectBrk: options.inspectBrk,
        });
        process.exitCode = exitCode;
        if (!options.inspect && !options.inspectBrk && process.env.LAMKIT_NO_FORCE_EXIT !== '1') {
          process.exit(exitCode);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exitCode = 1;
      }
    },
  );

program
  .command('list')
  .description('List configured Lambda functions')
  .option('--cwd <dir>', 'Project directory containing lamkit.config.js')
  .option('--reload-config', 'Reload lamkit.config (bypass config cache)')
  .action(async (options: { cwd?: string; reloadConfig?: boolean }) => {
    try {
      const { runListCommand } = await import('./commands/list.js');
      process.exitCode = await runListCommand(options.cwd, {
        reloadConfig: options.reloadConfig,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
  });

program
  .command('config')
  .description('Show merged effective config for a function')
  .argument('[function-name]', 'Function name from lamkit.config.js')
  .option('--cwd <dir>', 'Project directory containing lamkit.config.js')
  .option('--reload-config', 'Reload lamkit.config (bypass config cache)')
  .action(async (functionName: string | undefined, options: { cwd?: string; reloadConfig?: boolean }) => {
    try {
      const { runConfigCommand } = await import('./commands/config.js');
      process.exitCode = await runConfigCommand(functionName, options.cwd, {
        reloadConfig: options.reloadConfig,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
  });

program
  .command('init')
  .description('Scaffold lamkit.config.js and local dev files')
  .option('--force', 'Overwrite existing template files')
  .option('--yes', 'Add test:lambda script to package.json when present')
  .option('--cwd <dir>', 'Target directory for scaffold files', process.cwd())
  .action(async (options: { force?: boolean; yes?: boolean; cwd: string }) => {
    try {
      const { runInitCommand } = await import('./commands/init.js');
      process.exitCode = await runInitCommand({
        cwd: options.cwd,
        force: options.force,
        yes: options.yes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
  });

const send = program.command('send').description('Send messages to real AWS SQS or SNS');

send
  .command('sqs')
  .description('Send a message to a real SQS queue')
  .argument('<function-name>', 'Function name from lamkit.config.js')
  .option('--cwd <dir>', 'Project directory containing lamkit.config.js')
  .option('--data <json>', 'JSON message body (supports @file.json)')
  .option('--data-file <file>', 'Read JSON message body from a file')
  .option('--message <text>', 'Raw message body')
  .option('--queue-url <url>', 'Override queue URL from config')
  .option('--reload-config', 'Reload lamkit.config (bypass config cache)')
  .action(
    async (
      functionName: string,
      options: {
        cwd?: string;
        data?: string;
        dataFile?: string;
        message?: string;
        queueUrl?: string;
        reloadConfig?: boolean;
      },
    ) => {
      try {
        const { runSendSqsCommand } = await import('./commands/send.js');
        process.exitCode = await runSendSqsCommand(functionName, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exitCode = 1;
      }
    },
  );

send
  .command('sns')
  .description('Publish a message to a real SNS topic')
  .argument('<function-name>', 'Function name from lamkit.config.js')
  .option('--cwd <dir>', 'Project directory containing lamkit.config.js')
  .option('--data <json>', 'JSON message body (supports @file.json)')
  .option('--data-file <file>', 'Read JSON message body from a file')
  .option('--message <text>', 'Raw message body')
  .option('--topic-arn <arn>', 'Override topic ARN from config')
  .option('--reload-config', 'Reload lamkit.config (bypass config cache)')
  .action(
    async (
      functionName: string,
      options: {
        cwd?: string;
        data?: string;
        dataFile?: string;
        message?: string;
        topicArn?: string;
        reloadConfig?: boolean;
      },
    ) => {
      try {
        const { runSendSnsCommand } = await import('./commands/send.js');
        process.exitCode = await runSendSnsCommand(functionName, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exitCode = 1;
      }
    },
  );

program
  .command('listen')
  .description('Poll a real SQS queue and invoke the local handler')
  .argument('[function-name]', 'Function name from lamkit.config.js')
  .option('--cwd <dir>', 'Project directory containing lamkit.config.js')
  .option('--batch-size <n>', 'Max messages per SQS poll (default 10)', (v) => Number(v))
  .option('--no-batch-invoke', 'Invoke once per message instead of one SQSEvent per poll batch')
  .option('--batch-invoke', 'Deprecated: batch invoke is the default; use --no-batch-invoke to disable')
  .option('--no-extend-visibility', 'Do not extend SQS visibility timeout during handler invoke')
  .option('--no-delete', 'Do not delete messages after successful processing')
  .option('--strict-failures', 'Exit 1 when any message in a poll batch fails (including partial batch)')
  .option('--once', 'Process one poll batch then exit')
  .option('--expect-messages', 'With --once, exit 1 when the queue poll returns no messages')
  .option('--reload', 'Reload handler module (bypass cache)')
  .option('--reload-config', 'Reload lamkit.config (bypass config cache)')
  .option('--raw-logs', 'Skip console capture during invoke (faster listen loop)')
  .option('--queue-url <url>', 'Override queue URL from config')
  .action(
    async (
      functionName: string | undefined,
      options: {
        cwd?: string;
        batchSize?: number;
        batchInvoke?: boolean;
        delete?: boolean;
        extendVisibility?: boolean;
        once?: boolean;
        expectMessages?: boolean;
        strictFailures?: boolean;
        reload?: boolean;
        reloadConfig?: boolean;
        rawLogs?: boolean;
        queueUrl?: string;
      },
    ) => {
      try {
        const { runListenCommand } = await import('./commands/listen.js');
        const exitCode = await runListenCommand(functionName, options);
        process.exitCode = exitCode;
        if (options.once && process.env.LAMKIT_NO_FORCE_EXIT !== '1') {
          process.exit(exitCode);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exitCode = 1;
      }
    },
  );

program.parse();

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
