import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const templatesDir = join(packageRoot, 'templates');

const TEMPLATE_FILES = [
  'lamkit.config.js',
  '.env.example',
  '.vscode/launch.json',
  'events/sample.json',
] as const;

export type InitCommandOptions = {
  cwd?: string;
  force?: boolean;
  yes?: boolean;
};

function copyTemplate(relativePath: string, cwd: string, force: boolean): boolean {
  const source = join(templatesDir, relativePath);
  const target = join(cwd, relativePath);

  if (!existsSync(source)) {
    throw new Error(`Missing template file: ${relativePath}`);
  }

  if (existsSync(target) && !force) {
    console.log(`skip ${relativePath} (already exists)`);
    return false;
  }

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`create ${relativePath}`);
  return true;
}

function maybeAddPackageScript(cwd: string, yes: boolean): void {
  if (!yes) {
    return;
  }

  const packageJsonPath = join(cwd, 'package.json');
  if (!existsSync(packageJsonPath)) {
    console.log('skip package.json scripts (no package.json found)');
    return;
  }

  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  pkg.scripts ??= {};
  if (pkg.scripts['test:lambda']) {
    console.log('skip package.json scripts (test:lambda already exists)');
    return;
  }

  pkg.scripts['test:lambda'] = 'lamkit test';
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log('update package.json scripts.test:lambda');
}

export async function runInitCommand(options: InitCommandOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();

  for (const relativePath of TEMPLATE_FILES) {
    copyTemplate(relativePath, cwd, options.force ?? false);
  }

  maybeAddPackageScript(cwd, options.yes ?? false);

  console.log('\nNext steps:');
  console.log('  1. Copy .env.example to .env');
  console.log('  2. Add a handler at src/lambda/handler.js (must export `handler`)');
  console.log('  3. Run: lamkit test --data \'{"id":"1"}\'');
  console.log('  4. Read docs: node_modules/aws-lambda-devkit/docs/getting-started.md');

  return 0;
}
