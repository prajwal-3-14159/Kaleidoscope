#!/usr/bin/env node
// Sets the public origin of the site (used in canonical links, hreflang,
// Open Graph URLs, the sitemap and structured data) across every static file.
//
//   node scripts/set-origin.mjs https://example.com
//
// The current origin is read from site.json; every occurrence of it in HTML,
// XML, webmanifest and JSON files is replaced, then site.json is updated and
// the app shell is regenerated.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const next = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\/[^/\s]+$/.test(next)) {
  console.error('usage: node scripts/set-origin.mjs https://your-domain.example');
  process.exit(2);
}
const siteFile = path.join(ROOT, 'site.json');
const site = JSON.parse(fs.readFileSync(siteFile, 'utf8'));
const prev = site.origin.replace(/\/$/, '');

const SKIP = new Set(['node_modules', '.git', '.github', '.claude', 'tests']);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|xml|webmanifest|json|txt)$/.test(e.name)) out.push(p);
  }
  return out;
}

let changed = 0;
for (const file of walk(ROOT)) {
  const s = fs.readFileSync(file, 'utf8');
  if (!s.includes(prev)) continue;
  fs.writeFileSync(file, s.split(prev).join(next));
  changed++;
  console.log('updated', path.relative(ROOT, file));
}
site.origin = next;
fs.writeFileSync(siteFile, JSON.stringify(site, null, 2) + '\n');
execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-shell.mjs')], { stdio: 'inherit' });
console.log(`origin ${prev} -> ${next} in ${changed} files`);
