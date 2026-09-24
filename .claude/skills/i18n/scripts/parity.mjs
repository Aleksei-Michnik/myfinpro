#!/usr/bin/env node
// Compare leaf keys of apps/web/messages/en.json and he.json; warn on Hebrew values that look untranslated.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.argv[2] ?? process.cwd();
const load = (l) => JSON.parse(readFileSync(resolve(root, 'apps/web/messages', `${l}.json`), 'utf8'));
const leaves = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, v]],
  );
const en = new Map(leaves(load('en')));
const he = new Map(leaves(load('he')));
const missing = [...en.keys()].filter((k) => !he.has(k));
const orphan = [...he.keys()].filter((k) => !en.has(k));
const suspicious = [...he].filter(
  ([k, v]) => typeof v === 'string' && v.length > 3 && !/[֐-׿]/.test(v) && v === en.get(k),
);
console.log(`en ${en.size} keys, he ${he.size} keys`);
if (missing.length) console.log(`MISSING in he (${missing.length}):\n  ${missing.join('\n  ')}`);
if (orphan.length) console.log(`ORPHAN in he (${orphan.length}):\n  ${orphan.join('\n  ')}`);
if (suspicious.length)
  console.log(`WARN identical to English, no Hebrew letters (${suspicious.length}):\n  ${suspicious.map(([k]) => k).join('\n  ')}`);
process.exit(missing.length || orphan.length ? 1 : 0);
