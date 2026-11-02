#!/usr/bin/env node
// Writes the per-language <head> metadata (scripts/shell-meta.mjs) into the app
// shell: index.html is the hand-edited source of truth for the markup, and
// ja/index.html is generated from it. Run after editing index.html:
//
//   node scripts/build-shell.mjs          # rewrite index.html meta + ja/index.html
//   node scripts/build-shell.mjs --check  # exit 1 if either file is out of date
//
// The site origin comes from site.json (see scripts/set-origin.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { META, structuredData } from './shell-meta.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

export function siteOrigin() {
  return JSON.parse(read('site.json')).origin.replace(/\/$/, '');
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Replace the value of one attribute on the first tag matching `tagRe`. */
function setAttr(html, tagRe, attr, value) {
  const m = html.match(tagRe);
  if (!m) throw new Error(`build-shell: tag not found: ${tagRe}`);
  const re = new RegExp(`(\\s${attr}=")[^"]*(")`);
  if (!re.test(m[0])) throw new Error(`build-shell: attribute ${attr} missing on ${m[0].slice(0, 60)}`);
  return html.replace(m[0], m[0].replace(re, `$1${esc(value)}$2`));
}

/** Render the shell for one language from the source markup. */
export function renderShell(src, lang, origin = siteOrigin()) {
  const m = META[lang];
  const url = origin + m.path;
  let h = src;
  h = h.replace(/<html lang="[a-z]{2}">/, `<html lang="${m.lang}">`);
  h = h.replace(/(<title[^>]*>)[^<]*(<\/title>)/, `$1${esc(m.title)}$2`);
  h = setAttr(h, /<meta name="description"[^>]*>/, 'content', m.description);
  h = setAttr(h, /<meta name="keywords"[^>]*>/, 'content', m.keywords);
  h = setAttr(h, /<link rel="canonical"[^>]*>/, 'href', url);
  h = setAttr(h, /<link rel="alternate" hreflang="en"[^>]*>/, 'href', `${origin}/`);
  h = setAttr(h, /<link rel="alternate" hreflang="ja"[^>]*>/, 'href', `${origin}/ja/`);
  h = setAttr(h, /<link rel="alternate" hreflang="x-default"[^>]*>/, 'href', `${origin}/`);
  h = setAttr(h, /<meta property="og:locale"[^>]*>/, 'content', m.locale);
  h = setAttr(h, /<meta property="og:locale:alternate"[^>]*>/, 'content', m.altLocale);
  h = setAttr(h, /<meta property="og:title"[^>]*>/, 'content', m.ogTitle);
  h = setAttr(h, /<meta property="og:description"[^>]*>/, 'content', m.description);
  h = setAttr(h, /<meta property="og:url"[^>]*>/, 'content', url);
  h = setAttr(h, /<meta property="og:image"[^>]*>/, 'content', `${origin}/assets/og/home.jpg`);
  h = setAttr(h, /<meta property="og:image:alt"[^>]*>/, 'content', m.imageAlt);
  h = setAttr(h, /<meta name="twitter:title"[^>]*>/, 'content', m.ogTitle);
  h = setAttr(h, /<meta name="twitter:description"[^>]*>/, 'content', m.description);
  h = setAttr(h, /<meta name="twitter:image"[^>]*>/, 'content', `${origin}/assets/og/home.jpg`);
  // The language switch is a real link to the other shell (crawlable), toggled in place by JS.
  h = setAttr(h, /<a id="btn-lang"[^>]*>/, 'href', m.altPath);
  h = setAttr(h, /<a id="btn-lang"[^>]*>/, 'hreflang', m.altPath === '/ja/' ? 'ja' : 'en');
  h = h.replace(/(<a id="btn-lang"[^>]*>)[^<]*(<\/a>)/, `$1${m.lang === 'ja' ? 'English' : '日本語'}$2`);
  const ld = JSON.stringify(structuredData(origin, m));
  h = h.replace(/(<script type="application\/ld\+json" id="ld-app">)[\s\S]*?(<\/script>)/, `$1${ld.replace(/<\//g, '<\\/')}$2`);
  h = h.replace(/(<noscript id="seo-intro">)[\s\S]*?(<\/noscript>)/, `$1${m.noscript}$2`);
  return h;
}

export function buildAll() {
  const src = read('index.html');
  return { 'index.html': renderShell(src, 'en'), 'ja/index.html': renderShell(src, 'ja') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const out = buildAll();
  let stale = 0;
  for (const [file, html] of Object.entries(out)) {
    const abs = path.join(ROOT, file);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (current === html) continue;
    stale++;
    if (check) console.error(`out of date: ${file} (run node scripts/build-shell.mjs)`);
    else { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, html); console.log(`wrote ${file}`); }
  }
  if (check && stale) process.exit(1);
  if (!stale) console.log('shell up to date');
}
