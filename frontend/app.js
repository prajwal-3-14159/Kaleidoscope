// State Variables
let state = {
    engine: 'python', // 'python' or 'js'
    type: 'mandelbrot',
    palette: 'cyberpunk',
    iterations: 150,
    xmin: -2.0,
    xmax: 1.0,
    ymin: -1.5,
    ymax: 1.5,
    julia: {
        cre: -0.7,
        cim: 0.27015
    },
    width: 800,
    height: 600,
    isRendering: false,
    nextRenderArgs: null,
};

// Default coordinates for reset
const defaults = {
    mandelbrot: { xmin: -2.0, xmax: 1.0, ymin: -1.5, ymax: 1.5 },
    julia:      { xmin: -2.0, xmax: 2.0, ymin: -1.5, ymax: 1.5 },
    ship:       { xmin: -2.2, xmax: 1.2, ymin: -2.0, ymax: 0.5 }
};

// Pre-defined color palettes for JS fallback (matches backend RGB stops exactly)
const PALETTES = {
    cyberpunk: [
        [10, 10, 30],
        [0, 128, 255],
        [128, 0, 255],
        [255, 0, 128],
        [255, 230, 255]
    ],
    fire: [
        [0, 0, 0],
        [120, 0, 0],
        [230, 90, 0],
        [255, 200, 0],
        [255, 255, 200]
    ],
    ocean: [
        [2, 8, 24],
        [0, 76, 153],
        [0, 153, 153],
        [102, 255, 178],
        [255, 255, 255]
    ],
    slate: [
        [15, 23, 42],
        [51, 65, 85],
        [100, 116, 139],
        [148, 163, 184],
        [241, 245, 249]
    ]
};

// DOM Elements
const canvas = document.getElementById('fractal-canvas');
const ctx = canvas.getContext('2d');
const viewportContainer = document.getElementById('viewport-container');
const loadingSpinner = document.getElementById('loading-spinner');

// Offscreen canvas for continuous zoom/pan preview
const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d');
let lastRenderBounds = null;
let renderTimeout = null;

// Controls
const btnEnginePython = document.getElementById('btn-engine-python');
const btnEngineJs = document.getElementById('btn-engine-js');

const btnMandelbrot = document.getElementById('btn-mandelbrot');
const btnJulia = document.getElementById('btn-julia');
const btnShip = document.getElementById('btn-ship');
const juliaSection = document.getElementById('julia-coords-section');
const sliderJuliaCre = document.getElementById('slider-julia-cre');
const sliderJuliaCim = document.getElementById('slider-julia-cim');
const valJuliaCre = document.getElementById('val-julia-cre');
const valJuliaCim = document.getElementById('val-julia-cim');

const palettePicker = document.getElementById('palette-picker');
const sliderIterations = document.getElementById('slider-iterations');
const valIterations = document.getElementById('val-iterations');

const btnReset = document.getElementById('btn-reset');
const btnDownload = document.getElementById('btn-download');

// HUD
const hudCenter = document.getElementById('hud-val-center');
const hudZoom = document.getElementById('hud-val-zoom');
const hudTime = document.getElementById('hud-val-time');

// Setup Canvas Size
function resizeCanvas() {
    const rect = viewportContainer.getBoundingClientRect();
    
    // Cap resolution to preserve high frame rates on canvas rendering
    const maxWidth = 1000;
    let w = Math.floor(rect.width);
    let h = Math.floor(rect.height);
    
    if (w > maxWidth) {
        h = Math.floor(h * (maxWidth / w));
        w = maxWidth;
    }
    
    state.width = w;
    state.height = h;
    
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
    
    adjustAspectRatio();
}

// Adjusts the complex plane coordinates to match the screen aspect ratio
function adjustAspectRatio() {
    const screenRatio = state.width / state.height;
    
    const cx = (state.xmin + state.xmax) / 2;
    const cy = (state.ymin + state.ymax) / 2;
    
    let complexWidth = state.xmax - state.xmin;
    let complexHeight = state.ymax - state.ymin;
    
    const mathRatio = complexWidth / complexHeight;
    
    if (screenRatio > mathRatio) {
        complexWidth = complexHeight * screenRatio;
    } else {
        complexHeight = complexWidth / screenRatio;
    }
    
    state.xmin = cx - complexWidth / 2;
    state.xmax = cx + complexWidth / 2;
    state.ymin = cy - complexHeight / 2;
    state.ymax = cy + complexHeight / 2;
}

// Color interpolator for client-side JS rendering
function interpolateColorJS(val, paletteName) {
    const stops = PALETTES[paletteName] || PALETTES.cyberpunk;
    const numStops = stops.length;
    const scaledVal = val * (numStops - 1);
    
    const idx1 = Math.floor(scaledVal);
    if (idx1 >= numStops - 1) return stops[numStops - 1];
    if (idx1 < 0) return stops[0];
    
    const idx2 = idx1 + 1;
    const t = scaledVal - idx1;
    
    const stop1 = stops[idx1];
    const stop2 = stops[idx2];
    
    const r = stop1[0] + t * (stop2[0] - stop1[0]);
    const g = stop1[1] + t * (stop2[1] - stop1[1]);
    const b = stop1[2] + t * (stop2[2] - stop1[2]);
    
    return [r, g, b];
}

// Client-side JS Calculation Engine (Serverless & Compute Friendly)
function renderJS() {
    const width = state.width;
    const height = state.height;
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;
    
    const xmin = state.xmin;
    const xmax = state.xmax;
    const ymin = state.ymin;
    const ymax = state.ymax;
    const maxIter = state.iterations;
    const type = state.type;
    const palette = state.palette;
    const cre = state.julia.cre;
    const cim = state.julia.cim;
    
    const dx = (xmax - xmin) / width;
    const dy = (ymax - ymin) / height;
    
    const escapeRadiusSq = 10000.0;
    const log2 = 0.6931471805599453;
    
    // Nested pixel loops
    for (let py = 0; py < height; py++) {
        const y0 = ymax - py * dy;
        const rowOffset = py * width * 4;
        
        for (let px = 0; px < width; px++) {
            const x0 = xmin + px * dx;
            
            let zx, zy, cx, cy;
            if (type === 'mandelbrot') {
                zx = 0.0; zy = 0.0;
                cx = x0; cy = y0;
            } else if (type === 'julia') {
                zx = x0; zy = y0;
                cx = cre; cy = cim;
            } else { // burning ship
                zx = 0.0; zy = 0.0;
                cx = x0; cy = y0;
            }
            
            let iteration = 0;
            let zx2 = 0.0;
            let zy2 = 0.0;
            
            while (zx2 + zy2 <= escapeRadiusSq && iteration < maxIter) {
                if (type === 'ship') {
                    // Burning Ship formula
                    zy = Math.abs(2.0 * zx * zy) + cy;
                    zx = zx2 - zy2 + cx;
                } else {
                    // Mandelbrot / Julia formula
                    zy = 2.0 * zx * zy + cy;
                    zx = zx2 - zy2 + cx;
                }
                zx2 = zx * zx;
                zy2 = zy * zy;
                iteration++;
            }
            
            let r = 0, g = 0, b = 0;
            if (iteration < maxIter) {
                const modulusSq = zx2 + zy2;
                if (modulusSq > 0) {
                    // Continuous potential formula for anti-banding smooth color transitions
                    const logZn = Math.log(modulusSq) / 2.0;
                    const nu = Math.log(logZn / log2) / log2;
                    const smoothI = iteration + 1 - nu;
                    let val = smoothI / maxIter;
                    val = Math.sqrt(val);
                    const color = interpolateColorJS(val, palette);
                    r = color[0];
                    g = color[1];
                    b = color[2];
                }
            }
            
            const pixelIdx = rowOffset + px * 4;
            data[pixelIdx] = r;
            data[pixelIdx + 1] = g;
            data[pixelIdx + 2] = b;
            data[pixelIdx + 3] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

// Server-side Python Numba Engine
async function renderPython() {
    const params = new URLSearchParams({
        width: state.width,
        height: state.height,
        xmin: state.xmin,
        xmax: state.xmax,
        ymin: state.ymin,
        ymax: state.ymax,
        max_iter: state.iterations,
        type: state.type,
        palette: state.palette,
        julia_cre: state.julia.cre,
        julia_cim: state.julia.cim
    });
    
    const response = await fetch(`/api/fractal?${params.toString()}`);
    if (!response.ok) throw new Error('API server returned error code');
    
    const buffer = await response.arrayBuffer();
    const pixels = new Uint8ClampedArray(buffer);
    
    if (pixels.length === state.width * state.height * 4) {
        const imageData = new ImageData(pixels, state.width, state.height);
        ctx.putImageData(imageData, 0, 0);
    }
}

function drawPreview() {
    if (!lastRenderBounds) return;
    
    const currW = state.xmax - state.xmin;
    const currH = state.ymax - state.ymin;
    
    const scaleX = currW / (lastRenderBounds.xmax - lastRenderBounds.xmin);
    const scaleY = currH / (lastRenderBounds.ymax - lastRenderBounds.ymin);
    
    const xOffset = ((lastRenderBounds.xmin - state.xmin) / currW) * canvas.width;
    const yOffset = ((state.ymax - lastRenderBounds.ymax) / currH) * canvas.height; 
    
    const drawW = canvas.width / scaleX;
    const drawH = canvas.height / scaleY;
    
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreenCanvas, xOffset, yOffset, drawW, drawH);
}

function debouncedRender() {
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        render();
    }, 150);
}

// Trigger Fractal Render (routing between Python and JS engines)
async function render() {
    if (state.isRendering) {
        state.nextRenderArgs = { ...state };
        return;
    }
    
    state.isRendering = true;
    updateHUDValues();
    
    const startTime = performance.now();
    let renderSuccess = false;
    
    try {
        if (state.engine === 'js') {
            // Local render using V8 JIT loop
            renderJS();
            renderSuccess = true;
            const endTime = performance.now();
            hudTime.textContent = `${Math.round(endTime - startTime)} ms (JS)`;
        } else {
            // Server render using Python Numba Parallel calculations
            await renderPython();
            renderSuccess = true;
            const endTime = performance.now();
            hudTime.textContent = `${Math.round(endTime - startTime)} ms (Py)`;
        }
    } catch (err) {
        console.warn('Backend unavailable or failed. Falling back to local JS calculation...', err);
        // Fallback to local JS engine if Python backend is offline
        try {
            renderJS();
            renderSuccess = true;
            const endTime = performance.now();
            hudTime.textContent = `${Math.round(endTime - startTime)} ms (JS Fallback)`;
        } catch (jsErr) {
            console.error('JS Fallback failed too:', jsErr);
        }
    } finally {
        if (renderSuccess) {
            offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
            offscreenCtx.drawImage(canvas, 0, 0);
            lastRenderBounds = { xmin: state.xmin, xmax: state.xmax, ymin: state.ymin, ymax: state.ymax };
        }
        
        state.isRendering = false;
        
        if (state.nextRenderArgs) {
            const next = state.nextRenderArgs;
            state.nextRenderArgs = null;
            
            state.xmin = next.xmin;
            state.xmax = next.xmax;
            state.ymin = next.ymin;
            state.ymax = next.ymax;
            state.iterations = next.iterations;
            state.palette = next.palette;
            state.type = next.type;
            state.julia = next.julia;
            state.engine = next.engine;
            
            render();
        }
    }
}

// HUD updates
function updateHUDValues() {
    const cx = ((state.xmin + state.xmax) / 2).toFixed(6);
    const cy = ((state.ymin + state.ymax) / 2).toFixed(6);
    hudCenter.textContent = `${cx}, ${cy}`;
    
    const currentWidth = state.xmax - state.xmin;
    const defaultWidth = defaults[state.type].xmax - defaults[state.type].xmin;
    const zoomLevel = (defaultWidth / currentWidth).toLocaleString(undefined, {
        maximumFractionDigits: 1
    });
    hudZoom.textContent = `${zoomLevel}x`;
}

// Reset view coordinates
function resetView() {
    const def = defaults[state.type];
    state.xmin = def.xmin;
    state.xmax = def.xmax;
    state.ymin = def.ymin;
    state.ymax = def.ymax;
    adjustAspectRatio();
    render();
}

// Choose computation engine
function setEngine(engine) {
    state.engine = engine;
    
    if (engine === 'python') {
        btnEnginePython.classList.add('active');
        btnEngineJs.classList.remove('active');
    } else {
        btnEngineJs.classList.add('active');
        btnEnginePython.classList.remove('active');
    }
    
    render();
}

// Choose fractal type
function setFractalType(type) {
    state.type = type;
    
    [btnMandelbrot, btnJulia, btnShip].forEach(btn => {
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    if (type === 'julia') {
        juliaSection.classList.remove('hidden');
    } else {
        juliaSection.classList.add('hidden');
    }
    
    resetView();
}

// Initialize controls and inputs
function initEvents() {
    // Engine selector buttons
    btnEnginePython.addEventListener('click', () => setEngine('python'));
    btnEngineJs.addEventListener('click', () => setEngine('js'));
    
    // Type Selectors
    btnMandelbrot.addEventListener('click', () => setFractalType('mandelbrot'));
    btnJulia.addEventListener('click', () => setFractalType('julia'));
    btnShip.addEventListener('click', () => setFractalType('ship'));
    
    // Julia Constant Slider Bindings
    sliderJuliaCre.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.julia.cre = val;
        valJuliaCre.textContent = val.toFixed(3);
        render();
    });
    sliderJuliaCim.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.julia.cim = val;
        valJuliaCim.textContent = val.toFixed(3);
        render();
    });
    
    // Iterations Slider
    sliderIterations.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.iterations = val;
        valIterations.textContent = val;
        render();
    });
    
    // Palette Picker Cards
    palettePicker.addEventListener('click', (e) => {
        const card = e.target.closest('.palette-card');
        if (!card) return;
        
        document.querySelectorAll('.palette-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        
        state.palette = card.dataset.palette;
        render();
    });
    
    // Action Buttons
    btnReset.addEventListener('click', resetView);
    
    // Download Canvas Image
    btnDownload.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `fractal_${state.type}_${state.palette}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
    
    // Drag to Pan Controls
    let isDragging = false;
    let startX, startY;
    
    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
    });
    
    window.addEventListener('mouseup', () => {
        isDragging = false;
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        if (dx === 0 && dy === 0) return;
        
        const complexWidth = state.xmax - state.xmin;
        const complexHeight = state.ymax - state.ymin;
        
        const shiftX = (dx / state.width) * complexWidth;
        const shiftY = (dy / state.height) * complexHeight;
        
        state.xmin -= shiftX;
        state.xmax -= shiftX;
        state.ymin += shiftY;
        state.ymax += shiftY;
        
        startX = e.clientX;
        startY = e.clientY;
        
        updateHUDValues();
        drawPreview();
        debouncedRender();
    });
    
    // Scroll Wheel to Zoom (centered at mouse location)
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const complexWidth = state.xmax - state.xmin;
        const complexHeight = state.ymax - state.ymin;
        
        const mouseRe = state.xmin + (mouseX / state.width) * complexWidth;
        const mouseIm = state.ymax - (mouseY / state.height) * complexHeight;
        
        const zoomFactor = e.deltaY < 0 ? 0.85 : 1.15;
        
        const newWidth = complexWidth * zoomFactor;
        const newHeight = complexHeight * zoomFactor;
        
        const ratioX = mouseX / state.width;
        const ratioY = mouseY / state.height;
        
        state.xmin = mouseRe - ratioX * newWidth;
        state.xmax = mouseRe + (1 - ratioX) * newWidth;
        
        state.ymin = mouseIm - (1 - ratioY) * newHeight;
        state.ymax = mouseIm + ratioY * newHeight;
        
        updateHUDValues();
        drawPreview();
        debouncedRender();
    }, { passive: false });
    
    // Resize Listener
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            resizeCanvas();
            render();
        }, 150);
    });
}

// Initial Bootstrapping
window.addEventListener('DOMContentLoaded', () => {
    resizeCanvas();
    initEvents();
    render();
});
