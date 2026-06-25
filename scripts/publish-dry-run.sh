#!/usr/bin/env bash
# Pre-publish dry run — build, test, pack, install in temp project, smoke-test CLI + API.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== aws-lambda-devkit publish dry-run ==="
echo "Package: $(node -p "require('./package.json').name")@$(node -p "require('./package.json').version")"
echo ""

run() {
  echo ">>> $*"
  "$@"
  echo ""
}

run npm run typecheck
run npm test
run npm run pack:check

echo ">>> npm publish --dry-run"
npm publish --dry-run
echo ""

TARBALL="$(npm pack --silent)"
TARBALL_PATH="$ROOT/$TARBALL"
echo ">>> Created tarball: $TARBALL_PATH ($(du -h "$TARBALL_PATH" | cut -f1))"
echo ""

SMOKE_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$SMOKE_DIR"
  rm -f "$TARBALL_PATH"
}
trap cleanup EXIT

cd "$SMOKE_DIR"
npm init -y >/dev/null 2>&1
# ESM project (matches lamkit.config.js export default)
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
pkg.type = 'module';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo ">>> npm install $TARBALL_PATH (clean temp project)"
npm install "$TARBALL_PATH" >/dev/null
echo ""

echo ">>> lamkit --version"
npx lamkit --version
echo ""

mkdir -p src/lambda
cat > src/lambda/handler.js <<'EOF'
export const handler = async (event) => {
  console.log('dry-run ok', event.Records?.length ?? 0);
};
EOF

cat > lamkit.config.js <<'EOF'
export default {
  functions: [
    { name: 'worker', entry: './src/lambda/handler.js', trigger: 'sqs' },
  ],
};
EOF

echo ">>> lamkit test"
npx lamkit test --data '{"orderId":"dry-run"}'
echo ""

echo ">>> programmatic API"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { defineConfig, LAMKIT_VERSION, buildSqsEvent } from 'aws-lambda-devkit';
import 'aws-lambda-devkit/config';
const expected = JSON.parse(readFileSync('node_modules/aws-lambda-devkit/package.json','utf8')).version;
const cfg = defineConfig({ functions: [{ name: 'w', entry: './x.js' }] });
if (LAMKIT_VERSION !== expected) throw new Error('version mismatch: ' + LAMKIT_VERSION + ' vs ' + expected);
if (cfg.functions.length !== 1) throw new Error('defineConfig failed');
if (buildSqsEvent({}).Records.length !== 1) throw new Error('buildSqsEvent failed');
console.log('API ok (v' + LAMKIT_VERSION + ')');
"
echo ""

echo ">>> shipped docs"
test -f node_modules/aws-lambda-devkit/docs/getting-started.md
test -f node_modules/aws-lambda-devkit/templates/lamkit.config.ts
ls node_modules/aws-lambda-devkit/docs/
echo ""

echo ">>> npm registry name check"
if npm view "$(node -p "require('$ROOT/package.json').name")" version 2>/dev/null; then
  echo "WARNING: package name already exists on npm registry"
  exit 1
else
  echo "Name available on registry (404 expected for first publish)"
fi
echo ""

echo "=== ALL DRY-RUN CHECKS PASSED ==="
echo "Ready to publish: npm publish"
