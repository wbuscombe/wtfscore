// WTFScore - plant hygiene canaries for a negative test.
// Writes two new files (exclusive create) into the directory given. It refuses
// any directory inside this source tree, so canaries never land in the repo.
//
// Usage: node tools/plant-canary.mjs <evidence-dir>

import { writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodedTerm } from './hygiene-scan.mjs';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node tools/plant-canary.mjs <evidence-dir>');
  process.exit(2);
}
const target = await realpath(path.resolve(dir));
const src = await realpath(SOURCE_ROOT);
if (target === src || target.startsWith(src + path.sep)) {
  console.error('refusing to plant canaries inside the source tree');
  process.exit(3);
}

const files = [
  ['canary-expletive.txt', `planted canary (expletive, mixed case): ${decodedTerm('expletive', 0).toUpperCase()}ing\n`],
  ['canary-brand.txt', `planted canary (source-site brand): see ${decodedTerm('brand', 0).toUpperCase()} scoreboard\n`],
];
for (const [name, body] of files) {
  await writeFile(path.join(target, name), body, { flag: 'wx' });
  console.log(`planted ${path.join(target, name)}`);
}
