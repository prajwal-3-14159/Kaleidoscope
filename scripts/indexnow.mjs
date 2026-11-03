#!/usr/bin/env node
// Tells IndexNow-enabled search engines (Bing, DuckDuckGo, Yandex, Naver, Seznam)
// that the site's URLs are new or changed, so they crawl them without waiting.
// Google does not use IndexNow: submit the sitemap in Google Search Console.
//
//   node scripts/indexnow.mjs            # submit every URL in sitemap.xml
//   node scripts/indexnow.mjs /learn/    # submit just these paths
//
// The key is stored in site.json ("indexNowKey") and served at /<key>.txt.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.json'), 'utf8'));
const origin = site.origin.replace(/\/$/, '');
const key = site.indexNowKey;
if (!key || origin.includes('SITE_ORIGIN')) {
  console.error('site.json needs a real origin and an indexNowKey');
  process.exit(2);
}
const keyFile = path.join(ROOT, `${key}.txt`);
if (!fs.existsSync(keyFile)) { console.error(`missing key file ${key}.txt at the repo root`); process.exit(2); }

const args = process.argv.slice(2);
const urls = args.length
  ? args.map((p) => origin + p)
  : [...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(origin).host, key, keyLocation: `${origin}/${key}.txt`, urlList: urls }),
});
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urls.length} URL(s)`);
if (res.status >= 400) { console.log(await res.text()); process.exit(1); }
