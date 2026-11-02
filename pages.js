// Shared behaviour for the content pages (learn/, about, privacy, terms).
// Keeps the language choice in sync with the app (same localStorage key) and
// marks the current page in the navigation. No dependencies, no tracking.

(() => {
  const KEY = 'kaleidoscope.lang';
  const lang = document.documentElement.lang === 'ja' ? 'ja' : 'en';

  // Remember the language of the page the user chose to read.
  try { localStorage.setItem(KEY, lang); } catch (_) { /* storage unavailable */ }

  // The language switch is a plain link to the counterpart page; store the
  // choice before navigating so the app and other pages follow it.
  for (const a of document.querySelectorAll('a.lang-switch')) {
    a.addEventListener('click', () => {
      try { localStorage.setItem(KEY, lang === 'ja' ? 'en' : 'ja'); } catch (_) { /* ignore */ }
    });
  }

  // Highlight the current section in the header navigation.
  const here = location.pathname.replace(/index\.html$/, '');
  for (const a of document.querySelectorAll('.site-nav a')) {
    const target = new URL(a.getAttribute('href'), location.href).pathname.replace(/index\.html$/, '');
    if (target !== '/' && target !== '/ja/' && here.startsWith(target)) a.setAttribute('aria-current', 'page');
  }

  // Heading anchors: clicking a heading copies a deep link (small convenience).
  for (const h of document.querySelectorAll('main h2[id], main h3[id]')) {
    const a = document.createElement('a');
    a.className = 'anchor';
    a.href = `#${h.id}`;
    a.setAttribute('aria-label', '#' + h.id);
    a.textContent = '#';
    h.append(a);
  }
})();
