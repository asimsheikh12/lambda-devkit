#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const depCount = Object.keys(pkg.dependencies ?? {}).length;

if (depCount > 4) {
  console.error(`pack:check failed — expected <= 4 runtime dependencies, got ${depCount}`);
  process.exit(1);
}

const output = execSync('npm pack --dry-run --json', { encoding: 'utf8', cwd: process.cwd() });
const packed = JSON.parse(output)[0];
const files = packed.files.map((entry) => entry.path);

const allowedPrefixes = [
  'package/',
  'package/dist/',
  'package/templates/',
  'package/docs/',
  'package/README.md',
  'package/CHANGELOG.md',
];
const disallowed = files.filter((file) => file.startsWith('package/examples/'));

if (disallowed.length > 0) {
  console.error('pack:check failed — unexpected paths in tarball:');
  for (const file of disallowed) {
    console.error(`  ${file}`);
  }
  process.exit(1);
}

const unpacked = packed.files.reduce((sum, entry) => sum + entry.size, 0);
const unpackedMb = unpacked / (1024 * 1024);

console.log(`pack:check ok — ${depCount} runtime deps, ~${unpackedMb.toFixed(2)} MB unpacked`);

if (unpackedMb >= 5) {
  console.warn(`pack:check warning — unpacked size ${unpackedMb.toFixed(2)} MB exceeds 5 MB target`);
}
