// Kaleidoscope — tiny i18n layer (en / ja). No dependencies.

const STORAGE_KEY = 'kaleidoscope.lang';
const SUPPORTED = ['en', 'ja'];

const en = {
  'app.doc-title': 'Kaleidoscope — Infinite Fractal Explorer',
  'app.title': 'KALEIDOSCOPE',
  'app.subtitle': 'Infinite fractal explorer',

  // HUD
  'hud.fractal': 'Fractal',
  'hud.center': 'Center',
  'hud.zoom': 'Zoom',
  'hud.iter': 'Iterations',
  'hud.mode': 'Mode',
  'hud.status': 'Status',

  'mode.gpu': 'GPU',
  'mode.gpu-deep': 'GPU · perturbation',
  'mode.cpu': 'CPU · {n} threads',
  'mode.cpu-deep': 'CPU · perturbation · {n} threads',

  'status.preview': 'Preview…',
  'status.rendering': 'Rendering {pct}%',
  'status.refining': 'Anti-aliasing {n}/{total}',
  'status.done': 'Done in {ms} ms',
  'status.reference': 'Computing reference orbit…',

  // Chrome
  'pip.hint': 'Julia set here — press J',
  'panel.toggle': 'Toggle controls',
  'panel.title': 'Controls',
  'panel.footer': 'H hides the UI · P toggles this panel · ? shows shortcuts',
  'hint.controls': 'Drag to pan · Scroll to zoom · Press ? for help',
  'lang.switch': '日本語',

  // Sections and controls
  'sec.fractal': 'Fractal',
  'sec.power': 'Shape',
  'sec.color': 'Color',
  'sec.detail': 'Detail',
  'sec.engine': 'Engine',
  'sec.explore': 'Explore',

  'ctl.julia': 'Julia mode',
  'ctl.julia-re': 'Real part (Re c)',
  'ctl.julia-im': 'Imaginary part (Im c)',
  'ctl.julia-tip': 'Tip: on a Mandelbrot-type fractal, hover and press J to open the Julia set for that point.',
  'ctl.power': 'Power (n)',
  'ctl.power-note': 'Ultra-deep zoom (beyond 10^5×) needs power 2.',
  'ctl.mapping': 'Color mapping',
  'map.sqrt': 'Square root',
  'map.log': 'Logarithmic',
  'map.linear': 'Linear',
  'ctl.density': 'Density',
  'ctl.offset': 'Offset',
  'ctl.cycle': 'Cycle colors',
  'ctl.cycle-speed': 'Cycle speed',
  'ctl.shading': 'Shading',
  'shade.flat': 'Flat',
  'shade.filaments': 'Filaments',
  'shade.relief': 'Relief',
  'ctl.light': 'Light angle',
  'ctl.interior': 'Interior',
  'interior.black': 'Black',
  'interior.glow': 'Glow',
  'ctl.auto-iter': 'Auto iterations',
  'ctl.iter': 'Max iterations',
  'ctl.iter-note': 'Higher values reveal finer structure near the boundary, but render slower.',
  'ctl.aa': 'Anti-aliasing',
  'ctl.res': 'Resolution',
  'ctl.res-note': 'Render scale relative to your screen. Lower is faster; 100% is sharpest.',
  'ctl.tour': 'Guided tour',
  'ctl.export-scale': 'Export scale',

  'engine.gpu': 'GPU',
  'engine.cpu': 'CPU',
  'engine.gpu-note': 'Runs on your graphics card via WebGL2. Fastest.',
  'engine.cpu-note': 'Runs on {n} CPU threads in your browser. Slower, but 64-bit precise.',
  'engine.no-webgl': 'WebGL2 is not available here — using the CPU engine.',

  'btn.fly': 'Fly',
  'btn.reset': 'Reset view',
  'btn.share': 'Copy link',
  'btn.export': 'Export PNG',
  'btn.benchmark': 'Benchmark…',

  // Fractals
  'fractal.mandelbrot': 'Mandelbrot',
  'fractal.burning-ship': 'Burning Ship',
  'fractal.tricorn': 'Tricorn',
  'fractal.celtic': 'Celtic',
  'fractal.buffalo': 'Buffalo',
  'fractal.sierpinski': 'Sierpiński',
  'fractal.julia-suffix': '{name} Julia',

  // Palettes
  'palette.neon': 'Neon',
  'palette.fire': 'Fire',
  'palette.ocean': 'Ocean',
  'palette.slate': 'Slate',
  'palette.classic': 'Classic',
  'palette.aurora': 'Aurora',
  'palette.ice': 'Ice',
  'palette.spectrum': 'Spectrum',

  // Toasts
  'toast.link-copied': 'Link copied',
  'toast.max-zoom': 'Maximum zoom reached for this setting',
  'toast.export-start': 'Rendering {w}×{h} image…',
  'toast.export-done': 'Image saved',
  'toast.deep-power': 'Deep zoom needs power 2 — zoom limited',
  'toast.copied': 'Copied',

  // Tours
  'tour.home': 'Overview',
  'tour.seahorse': 'Seahorse Valley',
  'tour.elephant': 'Elephant Valley',
  'tour.spiral': 'Triple spiral',
  'tour.minibrot': 'Mini Mandelbrot',
  'tour.deep': 'Deep spiral (10⁻³⁰)',
  'tour.rabbit': 'Douady rabbit',
  'tour.dendrite': 'Dendrite',
  'tour.siegel': 'Siegel disk',
  'tour.ship': 'Burning Ship armada',
  'tour.sierpinski-deep': 'Infinite Sierpiński',

  // Benchmark
  'bench.title': 'Benchmark',
  'bench.desc': 'Renders a fixed set of animated scenes at a fixed resolution. The work is identical on every machine, so scores are directly comparable. It measures how many pixels per second your device can render.',
  'bench.quick': 'Quick',
  'bench.quick-desc': '5 scenes · ~30 s · 1280×720',
  'bench.full': 'Full',
  'bench.full-desc': '5 scenes · ~2 min · 1920×1080',
  'bench.run': 'Start',
  'bench.history': 'Previous runs',
  'bench.empty': 'No runs yet',
  'bench.score': 'Score',
  'bench.col-scene': 'Scene',
  'bench.col-fps': 'Avg FPS',
  'bench.col-time': 'Time',
  'bench.copy': 'Copy result',
  'bench.again': 'Run again',
  'bench.close': 'Close',
  'bench.abort': 'Stop',
  'bench.aborted': 'Benchmark stopped',
  'bench.preparing': 'Preparing {scene}…',
  'bench.meta': '{engine} · {res} · {gpu} · {date}',
  'bench.fps': 'FPS',
  'bench.elapsed': 'Elapsed',
  'bench.scene.seahorse': 'Seahorse dive',
  'bench.scene.julia': 'Julia morph',
  'bench.scene.ship': 'Burning Ship armada',
  'bench.scene.power': 'Power morph',
  'bench.scene.deep': 'Deep zoom 10³⁰',

  // Help
  'help.title': 'Shortcuts',
  'help.close': 'Close',
  'help.k.drag': 'Drag',
  'help.k.wheel': 'Wheel / Pinch',
  'help.k.dblclick': 'Double-click',
  'help.drag': 'Pan the view',
  'help.wheel': 'Zoom toward the cursor',
  'help.dblclick': 'Zoom in (hold Shift to zoom out)',
  'help.arrows': 'Pan',
  'help.zoomkeys': 'Zoom in / out',
  'help.reset': 'Reset the view',
  'help.julia': 'Open the Julia set at the cursor (Mandelbrot-type fractals)',
  'help.cycle': 'Toggle color cycling',
  'help.hide': 'Hide / show the interface',
  'help.fullscreen': 'Toggle fullscreen',
  'help.panel': 'Toggle the control panel',
  'help.help': 'Show this help',
  'help.esc': 'Close dialog / stop benchmark',
};

const ja = {
  'app.doc-title': 'Kaleidoscope — 無限フラクタル・エクスプローラー',
  'app.title': 'KALEIDOSCOPE',
  'app.subtitle': '無限のフラクタルを探検',

  'hud.fractal': 'フラクタル',
  'hud.center': '中心',
  'hud.zoom': 'ズーム',
  'hud.iter': '反復回数',
  'hud.mode': 'モード',
  'hud.status': '状態',

  'mode.gpu': 'GPU',
  'mode.gpu-deep': 'GPU · 摂動法',
  'mode.cpu': 'CPU · {n} スレッド',
  'mode.cpu-deep': 'CPU · 摂動法 · {n} スレッド',

  'status.preview': 'プレビュー中…',
  'status.rendering': '描画中 {pct}%',
  'status.refining': 'アンチエイリアス処理 {n}/{total}',
  'status.done': '{ms} ms で完了',
  'status.reference': '参照軌道を計算中…',

  'pip.hint': 'ここのジュリア集合 — J キー',
  'panel.toggle': 'コントロールの表示切替',
  'panel.title': 'コントロール',
  'panel.footer': 'H で UI を隠す · P でパネル切替 · ? でショートカット一覧',
  'hint.controls': 'ドラッグで移動 · スクロールでズーム · ? でヘルプ',
  'lang.switch': 'English',

  'sec.fractal': 'フラクタル',
  'sec.power': '形状',
  'sec.color': 'カラー',
  'sec.detail': 'ディテール',
  'sec.engine': 'エンジン',
  'sec.explore': '探索',

  'ctl.julia': 'ジュリア集合モード',
  'ctl.julia-re': '実部 (Re c)',
  'ctl.julia-im': '虚部 (Im c)',
  'ctl.julia-tip': 'ヒント: マンデルブロ系のフラクタル上でカーソルを合わせて J キーを押すと、その点のジュリア集合を開けます。',
  'ctl.power': 'べき乗 (n)',
  'ctl.power-note': '超深度ズーム（10^5 倍以上）にはべき乗 2 が必要です。',
  'ctl.mapping': '色のマッピング',
  'map.sqrt': '平方根',
  'map.log': '対数',
  'map.linear': '線形',
  'ctl.density': '色の密度',
  'ctl.offset': '色のオフセット',
  'ctl.cycle': 'カラーサイクル',
  'ctl.cycle-speed': 'サイクル速度',
  'ctl.shading': 'シェーディング',
  'shade.flat': 'フラット',
  'shade.filaments': 'フィラメント',
  'shade.relief': 'レリーフ',
  'ctl.light': '光の角度',
  'ctl.interior': '内部の表示',
  'interior.black': '黒',
  'interior.glow': '発光',
  'ctl.auto-iter': '反復回数を自動調整',
  'ctl.iter': '最大反復回数',
  'ctl.iter-note': '大きくすると境界付近の細かな構造まで見えますが、描画は遅くなります。',
  'ctl.aa': 'アンチエイリアス',
  'ctl.res': '解像度',
  'ctl.res-note': '画面に対する描画スケールです。低いほど高速で、100% が最も鮮明です。',
  'ctl.tour': 'ガイドツアー',
  'ctl.export-scale': '書き出し倍率',

  'engine.gpu': 'GPU',
  'engine.cpu': 'CPU',
  'engine.gpu-note': 'WebGL2 でグラフィックカード上で実行します。最速です。',
  'engine.cpu-note': 'ブラウザ内の CPU {n} スレッドで実行します。低速ですが 64 ビット精度です。',
  'engine.no-webgl': 'WebGL2 を利用できないため、CPU エンジンを使用します。',

  'btn.fly': '移動',
  'btn.reset': 'ビューをリセット',
  'btn.share': 'リンクをコピー',
  'btn.export': 'PNG で保存',
  'btn.benchmark': 'ベンチマーク…',

  'fractal.mandelbrot': 'マンデルブロ',
  'fractal.burning-ship': 'バーニングシップ',
  'fractal.tricorn': 'トライコーン',
  'fractal.celtic': 'ケルト',
  'fractal.buffalo': 'バッファロー',
  'fractal.sierpinski': 'シェルピンスキー',
  'fractal.julia-suffix': '{name}・ジュリア',

  'palette.neon': 'ネオン',
  'palette.fire': 'ファイア',
  'palette.ocean': 'オーシャン',
  'palette.slate': 'スレート',
  'palette.classic': 'クラシック',
  'palette.aurora': 'オーロラ',
  'palette.ice': 'アイス',
  'palette.spectrum': 'スペクトル',

  'toast.link-copied': 'リンクをコピーしました',
  'toast.max-zoom': 'この設定ではこれ以上ズームできません',
  'toast.export-start': '{w}×{h} の画像を描画中…',
  'toast.export-done': '画像を保存しました',
  'toast.deep-power': '深いズームにはべき乗 2 が必要です。ズームを制限しました',
  'toast.copied': 'コピーしました',

  'tour.home': '全体表示',
  'tour.seahorse': 'タツノオトシゴの谷',
  'tour.elephant': 'ゾウの谷',
  'tour.spiral': '三重らせん',
  'tour.minibrot': 'ミニ・マンデルブロ',
  'tour.deep': '深層のらせん (10⁻³⁰)',
  'tour.rabbit': 'ドゥアディのウサギ',
  'tour.dendrite': 'デンドライト（樹状集合）',
  'tour.siegel': 'ジーゲル円板',
  'tour.ship': 'バーニングシップの艦隊',
  'tour.sierpinski-deep': '果てしないシェルピンスキー',

  'bench.title': 'ベンチマーク',
  'bench.desc': '動きのあるシーンを一定の解像度で順に描画します。どのマシンでも処理量は同じなので、スコアをそのまま比較できます。1 秒あたりに描画できたピクセル数を測定します。',
  'bench.quick': 'クイック',
  'bench.quick-desc': '5 シーン · 約 30 秒 · 1280×720',
  'bench.full': 'フル',
  'bench.full-desc': '5 シーン · 約 2 分 · 1920×1080',
  'bench.run': '開始',
  'bench.history': '過去の結果',
  'bench.empty': 'まだ実行されていません',
  'bench.score': 'スコア',
  'bench.col-scene': 'シーン',
  'bench.col-fps': '平均 FPS',
  'bench.col-time': '時間',
  'bench.copy': '結果をコピー',
  'bench.again': 'もう一度実行',
  'bench.close': '閉じる',
  'bench.abort': '停止',
  'bench.aborted': 'ベンチマークを中止しました',
  'bench.preparing': '{scene} を準備中…',
  'bench.meta': '{engine} · {res} · {gpu} · {date}',
  'bench.fps': 'FPS',
  'bench.elapsed': '経過',
  'bench.scene.seahorse': 'タツノオトシゴへのダイブ',
  'bench.scene.julia': 'ジュリア・モーフ',
  'bench.scene.ship': 'バーニングシップの艦隊',
  'bench.scene.power': 'べき乗モーフ',
  'bench.scene.deep': '超深度ズーム 10³⁰',

  'help.title': 'ショートカット',
  'help.close': '閉じる',
  'help.k.drag': 'ドラッグ',
  'help.k.wheel': 'ホイール / ピンチ',
  'help.k.dblclick': 'ダブルクリック',
  'help.drag': '表示位置を移動',
  'help.wheel': 'カーソル位置を中心にズーム',
  'help.dblclick': 'ズームイン（Shift でズームアウト）',
  'help.arrows': '表示位置を移動',
  'help.zoomkeys': 'ズームイン / アウト',
  'help.reset': 'ビューをリセット',
  'help.julia': 'カーソル位置のジュリア集合を開く（マンデルブロ系）',
  'help.cycle': 'カラーサイクルの切替',
  'help.hide': 'UI の表示 / 非表示',
  'help.fullscreen': '全画面表示の切替',
  'help.panel': 'コントロールパネルの切替',
  'help.help': 'このヘルプを表示',
  'help.esc': 'ダイアログを閉じる / ベンチマークを中止',
};

const dictionaries = { en, ja };
const listeners = new Set();

function detectInitialLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED.includes(stored)) return stored;
  } catch (_) { /* storage unavailable */ }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
  return nav.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

let currentLang = detectInitialLang();

export function t(key, vars = {}) {
  const raw = dictionaries[currentLang]?.[key] ?? dictionaries.en[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m);
}

export function getLang() {
  return currentLang;
}

export function applyTranslations(root = document) {
  if (!root || !root.querySelectorAll) return;
  const all = (selector) => {
    const list = Array.from(root.querySelectorAll(selector));
    if (root.matches && root.matches(selector)) list.unshift(root);
    return list;
  };
  for (const el of all('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (key.endsWith('.html')) el.innerHTML = t(key);
    else el.textContent = t(key);
  }
  for (const el of all('[data-i18n-title]')) el.title = t(el.getAttribute('data-i18n-title'));
  for (const el of all('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  for (const el of all('[data-i18n-placeholder]')) el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
}

export function setLang(lang) {
  if (!SUPPORTED.includes(lang)) lang = 'en';
  currentLang = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) { /* ignore */ }
  document.documentElement.lang = lang;
  applyTranslations(document);
  for (const cb of listeners) {
    try { cb(lang); } catch (err) { console.error(err); }
  }
}

export function toggleLang() {
  setLang(currentLang === 'ja' ? 'en' : 'ja');
}

export function onLangChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Initial application once the DOM is ready (no listener notification, no storage write).
function init() {
  document.documentElement.lang = currentLang;
  applyTranslations(document);
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}
