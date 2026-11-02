// Per-language <head> metadata for the app shell (index.html and ja/index.html).
// scripts/build-shell.mjs writes these values into both files; src/i18n.js holds
// the runtime copies used when the language is toggled without a reload
// (scripts/check-site.mjs verifies the two stay identical).

export const META = {
  en: {
    lang: 'en',
    path: '/',
    altPath: '/ja/',
    locale: 'en_US',
    altLocale: 'ja_JP',
    title: 'Kaleidoscope — Infinite Fractal Explorer',
    ogTitle: 'Kaleidoscope — Infinite Fractal Explorer',
    description: 'Explore the Mandelbrot set, Julia sets, Burning Ship and more in your browser. Free WebGL2 fractal explorer with ultra-deep zoom to 10^300, smooth colouring, PNG export and a GPU benchmark.',
    imageAlt: 'Seahorse Valley of the Mandelbrot set rendered by Kaleidoscope',
    keywords: 'fractal explorer, Mandelbrot set, Julia set, Burning Ship, deep zoom, WebGL, GPU benchmark, fractal math',
    featureList: [
      'Mandelbrot, Burning Ship, Tricorn, Celtic, Buffalo and Sierpiński fractals, each with Julia variants',
      'Ultra-deep zoom to about 10^300 using perturbation theory',
      'GPU (WebGL2) and multi-threaded CPU engines',
      'Smooth colouring, distance-estimate filaments and 3D relief lighting',
      'High-resolution PNG export and shareable links',
      'Guided tour, benchmark mode and optional video recording',
      'English and Japanese interface',
    ],
    noscript: `<div class="noscript"><p>Kaleidoscope is a free fractal explorer that runs in your browser: zoom into the Mandelbrot set, Julia sets, the Burning Ship and more, with GPU acceleration and ultra-deep zoom. It needs JavaScript and a browser with WebGL2.</p><ul><li><a href="/learn/">Fractal encyclopedia</a></li><li><a href="/about.html">About Kaleidoscope</a></li><li><a href="/ja/">日本語</a></li></ul></div>`,
  },
  ja: {
    lang: 'ja',
    path: '/ja/',
    altPath: '/',
    locale: 'ja_JP',
    altLocale: 'en_US',
    title: 'Kaleidoscope — 無限フラクタル・エクスプローラー',
    ogTitle: 'Kaleidoscope — 無限フラクタル・エクスプローラー',
    description: 'マンデルブロ集合、ジュリア集合、バーニングシップなどをブラウザで探索。10^300 倍まで超深度ズームできる無料の WebGL2 フラクタル・エクスプローラー。滑らかな配色、PNG 書き出し、GPU ベンチマーク付き。',
    imageAlt: 'Kaleidoscope で描画したマンデルブロ集合のタツノオトシゴの谷',
    keywords: 'フラクタル, マンデルブロ集合, ジュリア集合, バーニングシップ, 深度ズーム, WebGL, GPU ベンチマーク, フラクタル 数学',
    featureList: [
      'マンデルブロ、バーニングシップ、トライコーン、ケルト、バッファロー、シェルピンスキーの各フラクタルとジュリア版',
      '摂動法による約 10^300 倍までの超深度ズーム',
      'GPU（WebGL2）エンジンとマルチスレッド CPU エンジン',
      '滑らかな配色、距離推定によるフィラメント表示、3D レリーフ照明',
      '高解像度 PNG 書き出しと共有リンク',
      'ガイドツアー、ベンチマークモード、動画録画（任意）',
      '英語・日本語インターフェース',
    ],
    noscript: `<div class="noscript"><p>Kaleidoscope はブラウザで動く無料のフラクタル・エクスプローラーです。マンデルブロ集合、ジュリア集合、バーニングシップなどを GPU で高速に描画し、超深度ズームで探索できます。JavaScript と WebGL2 対応ブラウザが必要です。</p><ul><li><a href="/ja/learn/">フラクタル百科</a></li><li><a href="/ja/about.html">Kaleidoscope について</a></li><li><a href="/">English</a></li></ul></div>`,
  },
};

/** JSON-LD structured data for the app shell in one language. */
export function structuredData(origin, m) {
  const url = origin + m.path;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        url: `${origin}/`,
        name: 'Kaleidoscope',
        inLanguage: ['en', 'ja'],
        publisher: { '@id': `${origin}/#org` },
      },
      {
        '@type': 'Organization',
        '@id': `${origin}/#org`,
        name: 'Kaleidoscope project',
        url: 'https://github.com/prajwal-3-14159/Kaleidoscope',
        logo: `${origin}/assets/icons/icon-512.png`,
      },
      {
        '@type': 'WebApplication',
        '@id': `${url}#app`,
        name: m.ogTitle,
        url,
        description: m.description,
        inLanguage: m.lang,
        applicationCategory: 'EducationalApplication',
        applicationSubCategory: 'Mathematics',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript and a browser with WebGL2',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        image: `${origin}/assets/og/home.jpg`,
        screenshot: `${origin}/assets/og/home.jpg`,
        keywords: m.keywords,
        featureList: m.featureList,
        author: { '@id': `${origin}/#org` },
        isPartOf: { '@id': `${origin}/#website` },
      },
    ],
  };
}
