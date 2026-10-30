export const translations = {
    en: {
        "app-title": "KALEIDOSCOPE",
        "subtitle": "Quantum Fractals &bull; WebGL Accelerated",
        "loading": "Computing Dimensions...",
        "hud-center": "Center:",
        "hud-zoom": "Zoom:",
        "hud-time": "Render Time:",
        "sec-engine": "RENDER ENGINE",
        "btn-webgl": "WebGL GPU",
        "btn-js": "Local Browser",
        "sec-fractal": "FRACTAL TYPE",
        "sec-power": "POWER (n)",
        "sec-julia": "JULIA CONSTANT (c)",
        "lbl-real": "Real (cr):",
        "lbl-imag": "Imag (ci):",
        "sec-palette": "COLOR PALETTE",
        "pal-cyberpunk": "Cyberpunk",
        "pal-fire": "Solarized Fire",
        "pal-ocean": "Deep Ocean",
        "pal-slate": "Mono Slate",
        "sec-iter": "MAX ITERATIONS",
        "desc-iter": "Controls detail level. High detail calculations compile instantly via Apple Silicon JIT.",
        "sec-res": "RESOLUTION SCALE",
        "desc-res": "Adjusts render resolution. 100% uses your monitor's native high-DPI (Retina/4K) pixels.",
        "btn-reset": "Reset Coordinates",
        "btn-download": "Export Image (PNG)",
        "btn-benchmark": "Run Benchmark",
        "footer-info": "💡 <strong>Controls:</strong> Drag to pan, scroll wheel or pinch to zoom into infinite detail.",
        
        "bench-title": "Performance Benchmark",
        "bench-time": "Time Remaining:",
        "bench-fps": "Current FPS:",
        "bench-highest": "Highest Score:",
        "bench-score-title": "Benchmark Complete",
        "bench-score-label": "Total Points:",
        "bench-score-close": "Close",
        "btn-benchmark-toggle": "Benchmark Mode",
        "btn-benchmark-start": "Start Benchmark",
        "btn-benchmark-stop": "Stop Benchmark",
        
        "fractal-0": "Mandelbrot",
        "fractal-1": "Julia Set",
        "fractal-2": "Burning Ship",
        "fractal-3": "Burning Ship Julia",
        "fractal-4": "Celtic",
        "fractal-5": "Celtic Julia",
        "fractal-6": "Tricorn",
        "fractal-7": "Tricorn Julia",
        "fractal-8": "Buffalo",
        "fractal-9": "Buffalo Julia",
        "fractal-10": "Sierpinski Triangle",
        "fractal-11": "Sierpinski Julia"
    },
    ja: {
        "app-title": "KALEIDOSCOPE",
        "subtitle": "量子フラクタル &bull; WebGLアクセラレーション",
        "loading": "次元を計算中...",
        "hud-center": "中心:",
        "hud-zoom": "ズーム:",
        "hud-time": "レンダリング時間:",
        "sec-engine": "レンダリングエンジン",
        "btn-webgl": "WebGL GPU",
        "btn-js": "ローカルブラウザ",
        "sec-fractal": "フラクタルタイプ",
        "sec-power": "べき乗 (n)",
        "sec-julia": "ジュリア定数 (c)",
        "lbl-real": "実部 (cr):",
        "lbl-imag": "虚部 (ci):",
        "sec-palette": "カラーパレット",
        "pal-cyberpunk": "サイバーパンク",
        "pal-fire": "ソラライズド・ファイア",
        "pal-ocean": "ディープ・オーシャン",
        "pal-slate": "モノ・スレート",
        "sec-iter": "最大反復回数",
        "desc-iter": "ディテールレベルを制御します。高精細な計算はApple Silicon JITで即座にコンパイルされます。",
        "sec-res": "解像度スケール",
        "desc-res": "レンダリング解像度を調整します。100%はモニターのネイティブ高DPI (Retina/4K) を使用します。",
        "btn-reset": "座標をリセット",
        "btn-download": "画像をエクスポート (PNG)",
        "btn-benchmark": "ベンチマークを実行",
        "footer-info": "💡 <strong>操作:</strong> ドラッグで移動、スクロールホイールまたはピンチで無限のディテールにズームイン。",

        "bench-title": "パフォーマンス・ベンチマーク",
        "bench-time": "残り時間:",
        "bench-fps": "現在のFPS:",
        "bench-highest": "最高スコア:",
        "bench-score-title": "ベンチマーク完了",
        "bench-score-label": "合計ポイント:",
        "bench-score-close": "閉じる",
        "btn-benchmark-toggle": "ベンチマーク モード",
        "btn-benchmark-start": "ベンチマーク開始",
        "btn-benchmark-stop": "ベンチマーク停止",

        "fractal-0": "マンデルブロ集合",
        "fractal-1": "ジュリア集合",
        "fractal-2": "バーニング・シップ",
        "fractal-3": "バーニング・シップ (ジュリア)",
        "fractal-4": "セルティック",
        "fractal-5": "セルティック (ジュリア)",
        "fractal-6": "トリコーン",
        "fractal-7": "トリコーン (ジュリア)",
        "fractal-8": "バッファロー",
        "fractal-9": "バッファロー (ジュリア)",
        "fractal-10": "シェルピンスキーのギャスケット",
        "fractal-11": "シェルピンスキー (ジュリア)"
    }
};

let currentLang = 'en';

export function getTranslation(key) {
    return translations[currentLang][key] || key;
}

export function setLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    
    // Update simple DOM elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            el.innerHTML = translations[lang][key];
        }
    });

    // We will trigger a custom event so app.js can re-render dynamic things like select options
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: lang }));
}

export function toggleLanguage() {
    setLanguage(currentLang === 'en' ? 'ja' : 'en');
}
