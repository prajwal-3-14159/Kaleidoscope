#!/usr/bin/env node
// Static quality gate for the site (run by CI and `npm run check`):
//   - every script parses (node --check)
//   - the English and Japanese dictionaries have the same keys and placeholders,
//     and every data-i18n key used in the markup exists
//   - the app shell's <head> metadata matches scripts/shell-meta.mjs and the
//     runtime strings, and ja/index.html is generated from index.html
//   - every HTML page has one <h1>, a description, canonical + hreflang pair,
//     parsable JSON-LD, and only internal links/assets that exist
//   - sitemap.xml lists every indexable page and only existing URLs
//   - site.webmanifest, staticwebapp.config.json and robots.txt are sane
// Exit code 1 on errors; warnings do not fail the run.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const SKIP_DIRS = new Set(['node_modules', '.git', '.claude']);
function walk(dir, pred, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------ 1. syntax
const scripts = walk(ROOT, (p) => /\.(m?js)$/.test(p) && !/[\\/](node_modules|\.git)[\\/]/.test(p));
for (const f of scripts) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { err(`syntax: ${rel(f)}: ${String(e.stderr || e.message).split('\n')[0]}`); }
}

// ------------------------------------------------------------------ 2. i18n parity
const { DICTIONARIES } = await import(pathToFileURL(path.join(ROOT, 'src/i18n.js')).href);
const { en, ja } = DICTIONARIES;
const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
for (const k of Object.keys(en)) {
  if (!(k in ja)) err(`i18n: key "${k}" missing in ja`);
  else if (vars(en[k]) !== vars(ja[k])) err(`i18n: placeholders differ for "${k}" (${vars(en[k])} vs ${vars(ja[k])})`);
}
for (const k of Object.keys(ja)) if (!(k in en)) err(`i18n: key "${k}" missing in en`);

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const m of indexHtml.matchAll(/data-i18n(?:-title|-aria|-placeholder|-content)?="([^"]+)"/g)) {
  if (!(m[1] in en)) err(`i18n: index.html uses unknown key "${m[1]}"`);
}

// ------------------------------------------------------------------ 3. shell metadata
const { META } = await import('./shell-meta.mjs');
const { buildAll, siteOrigin } = await import('./build-shell.mjs');
for (const lang of ['en', 'ja']) {
  const d = DICTIONARIES[lang];
  if (META[lang].title !== d['app.doc-title']) err(`shell-meta: ${lang} title differs from i18n app.doc-title`);
  if (META[lang].ogTitle !== d['app.og-title']) err(`shell-meta: ${lang} ogTitle differs from i18n app.og-title`);
  if (META[lang].description !== d['app.doc-desc']) err(`shell-meta: ${lang} description differs from i18n app.doc-desc`);
}
let origin = 'https://SITE_ORIGIN';
try {
  origin = siteOrigin();
  for (const [file, html] of Object.entries(buildAll())) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) err(`shell: ${file} is missing (run node scripts/build-shell.mjs)`);
    else if (fs.readFileSync(abs, 'utf8') !== html) err(`shell: ${file} is out of date (run node scripts/build-shell.mjs)`);
  }
} catch (e) { err(`shell: ${e.message}`); }
const placeholderOrigin = origin.includes('SITE_ORIGIN');
if (placeholderOrigin) warn('site.json still has the placeholder origin; run: node scripts/set-origin.mjs https://your-domain');

// ------------------------------------------------------------------ 4. HTML pages
const htmlFiles = walk(ROOT, (p) => p.endsWith('.html') && !/[\\/](tests|scripts)[\\/]/.test(p));
const pageUrls = new Set();          // site paths of indexable pages
const resolveLocal = (fromFile, href) => {
  let p = href.replace(/[#?].*$/, '');
  if (!p) return null;
  if (p.startsWith(origin)) p = p.slice(origin.length) || '/';
  if (/^[a-z]+:/i.test(p)) return null;                    // external / mailto / data
  const abs = p.startsWith('/') ? path.join(ROOT, p) : path.resolve(path.dirname(fromFile), p);
  return p.endsWith('/') ? path.join(abs, 'index.html') : abs;
};

for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf8');
  const name = rel(f);
  const is404 = path.basename(f) === '404.html';
  const inJa = /(^|\/)ja\//.test(name);
  const lang = (html.match(/<html[^>]*\blang="([^"]+)"/) || [])[1];
  if (!lang) err(`${name}: missing <html lang>`);
  else if (!is404 && (lang === 'ja') !== inJa) err(`${name}: lang="${lang}" does not match its directory`);
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) err(`${name}: expected exactly one <h1>, found ${h1s}`);
  if (!/<meta name="description" [^>]*content="[^"]+"/.test(html) && !/<meta name="description" data-i18n-content/.test(html)) err(`${name}: missing meta description`);
  if (!is404) {
    const canon = (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
    if (!canon) err(`${name}: missing canonical`);
    else if (!canon.startsWith(origin)) err(`${name}: canonical "${canon}" does not start with ${origin}`);
    else pageUrls.add(canon.slice(origin.length));
    for (const hl of ['en', 'ja', 'x-default']) {
      if (!new RegExp(`<link rel="alternate" hreflang="${hl}" href="${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*"`).test(html)) err(`${name}: missing hreflang="${hl}"`);
    }
    if (!/<meta property="og:title"/.test(html)) warn(`${name}: no Open Graph title`);
  }
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!m[1].trim()) { if (!is404) err(`${name}: empty JSON-LD`); continue; }
    try { JSON.parse(m[1]); } catch (e) { err(`${name}: JSON-LD does not parse: ${e.message}`); }
  }
  if (html.includes('SITE_ORIGIN') && !placeholderOrigin) err(`${name}: still contains the SITE_ORIGIN placeholder`);
  // Links and assets.
  for (const m of html.matchAll(/\b(?:href|src|poster)="([^"]+)"/g)) {
    const target = resolveLocal(f, m[1]);
    if (!target) continue;
    if (!fs.existsSync(target)) err(`${name}: broken link "${m[1]}"`);
  }
  for (const m of html.matchAll(/<meta (?:property|name)="(?:og:image|twitter:image)" content="([^"]+)"/g)) {
    const target = resolveLocal(f, m[1]);
    if (target && !fs.existsSync(target)) err(`${name}: missing image "${m[1]}"`);
  }
}

// ------------------------------------------------------------------ 5. sitemap
const sitemapFile = path.join(ROOT, 'sitemap.xml');
if (!fs.existsSync(sitemapFile)) err('sitemap.xml is missing');
else {
  const xml = fs.readFileSync(sitemapFile, 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const listed = new Set();
  for (const loc of locs) {
    if (!loc.startsWith(origin)) { err(`sitemap: "${loc}" does not start with ${origin}`); continue; }
    const p = loc.slice(origin.length) || '/';
    listed.add(p);
    const target = resolveLocal(path.join(ROOT, 'index.html'), p);
    if (!target || !fs.existsSync(target)) err(`sitemap: "${loc}" does not resolve to a file`);
  }
  for (const p of pageUrls) if (!listed.has(p)) warn(`sitemap: page ${p} is not listed`);
  for (const m of xml.matchAll(/<xhtml:link[^>]*href="([^"]+)"/g)) {
    const target = resolveLocal(path.join(ROOT, 'index.html'), m[1]);
    if (!target || !fs.existsSync(target)) err(`sitemap: hreflang "${m[1]}" does not resolve to a file`);
  }
}

// ------------------------------------------------------------------ 6. manifest, config, robots
try {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.webmanifest'), 'utf8'));
  for (const icon of man.icons || []) if (!fs.existsSync(path.join(ROOT, icon.src))) err(`manifest: icon ${icon.src} is missing`);
  if (!man.name || !man.start_url) err('manifest: name/start_url missing');
} catch (e) { err(`site.webmanifest: ${e.message}`); }
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'staticwebapp.config.json'), 'utf8'));
  const notFound = cfg.responseOverrides?.['404']?.rewrite;
  if (notFound && !fs.existsSync(path.join(ROOT, notFound))) err(`staticwebapp.config.json: 404 page ${notFound} is missing`);
} catch (e) { err(`staticwebapp.config.json: ${e.message}`); }
try {
  const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  if (!/^Sitemap:\s*\S+/m.test(robots)) warn('robots.txt: no Sitemap line');
} catch { err('robots.txt is missing'); }

// ------------------------------------------------------------------ report
for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`${errors.length} error(s), ${warnings.length} warning(s), ${htmlFiles.length} pages, ${scripts.length} scripts`);
process.exit(errors.length ? 1 : 0);
