// Pre-defined Fractal Types
const FRACTAL_TYPES = [
    { id: 0, name: 'Mandelbrot', isJulia: false },
    { id: 1, name: 'Julia Set', isJulia: true },
    { id: 2, name: 'Burning Ship', isJulia: false },
    { id: 3, name: 'Burning Ship (Julia)', isJulia: true },
    { id: 4, name: 'Tricorn / Mandelbar', isJulia: false },
    { id: 5, name: 'Tricorn (Julia)', isJulia: true },
    { id: 6, name: 'Celtic Mandelbrot', isJulia: false },
    { id: 7, name: 'Celtic (Julia)', isJulia: true },
    { id: 8, name: 'Buffalo', isJulia: false },
    { id: 9, name: 'Buffalo (Julia)', isJulia: true },
    { id: 10, name: 'Mandelbrot ^3', isJulia: false },
    { id: 11, name: 'Julia ^3', isJulia: true },
    { id: 12, name: 'Mandelbrot ^4', isJulia: false },
    { id: 13, name: 'Julia ^4', isJulia: true },
    { id: 14, name: 'Mandelbrot ^5', isJulia: false },
    { id: 15, name: 'Julia ^5', isJulia: true },
    { id: 16, name: 'Burning Ship ^3', isJulia: false },
    { id: 17, name: 'Burning Ship ^3 (Julia)', isJulia: true },
    { id: 18, name: 'Burning Ship ^4', isJulia: false },
    { id: 19, name: 'Burning Ship ^4 (Julia)', isJulia: true },
    { id: 20, name: 'Tricorn ^3', isJulia: false },
    { id: 21, name: 'Tricorn ^3 (Julia)', isJulia: true },
    { id: 22, name: 'Tricorn ^4', isJulia: false },
    { id: 23, name: 'Tricorn ^4 (Julia)', isJulia: true }
];

// Global Application State
let state = {
    engine: 'python', // 'python' or 'js'
    palette: 'cyberpunk',
    iterations: 150,
    xmin: -2.0,
    xmax: 1.0,
    ymin: -1.2,
    ymax: 1.2,
    fractal_id: 0,
    julia: {
        cre: -0.4,
        cim: 0.6
    },
    width: 800,
    height: 600,
    isRendering: false,
    nextRenderArgs: null,
    resolutionScale: 1.0,
};

// Reset bounds to default based on fractal type
function resetFractalBounds() {
    const isJulia = state.fractal_id % 2 === 1;
    const baseType = Math.floor(state.fractal_id / 2);
    
    if (isJulia) {
        state.xmin = -2.0; state.xmax = 2.0;
        state.ymin = -1.5; state.ymax = 1.5;
    } else {
        if (baseType === 0) { // Standard Mandelbrot
            state.xmin = -2.0; state.xmax = 1.0;
            state.ymin = -1.2; state.ymax = 1.2;
        } else {
            state.xmin = -2.0; state.xmax = 2.0;
            state.ymin = -2.0; state.ymax = 2.0;
        }
    }
    
    adjustAspectRatio();
    drawPreview();
    render();
}

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

// WebGL Setup
const glCanvas = document.createElement('canvas');
const gl = glCanvas.getContext('webgl');
let glProgram = null;

const vsSource = `
    attribute vec2 a_position;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

const fsSource = `
    precision highp float;

    uniform vec2 u_resolution;
    uniform vec2 u_offset;
    uniform vec2 u_range;
    uniform vec2 u_julia_c;
    uniform int u_max_iter;
    uniform int u_base_type;
    uniform bool u_is_julia;
    uniform vec3 u_palette[5];

    void main() {
        vec2 st = gl_FragCoord.xy / u_resolution;
        vec2 c0 = u_offset + st * u_range;
        
        vec2 z = u_is_julia ? c0 : vec2(0.0);
        vec2 c = u_is_julia ? u_julia_c : c0;
        
        float iter = 0.0;
        float x2 = 0.0;
        float y2 = 0.0;
        float max_iter_f = float(u_max_iter);
        
        for(int i=0; i<2000; i++) {
            if (float(i) >= max_iter_f) break;
            if (x2 + y2 > 10000.0) break;
            
            float x_new = 0.0;
            float y_new = 0.0;
            float x = z.x;
            float y = z.y;
            
            if (u_base_type == 0) { // Mandelbrot
                x_new = x2 - y2;
                y_new = 2.0 * x * y;
            } else if (u_base_type == 1) { // Burning Ship
                x_new = x2 - y2;
                y_new = 2.0 * abs(x * y);
            } else if (u_base_type == 2) { // Tricorn
                x_new = x2 - y2;
                y_new = -2.0 * x * y;
            } else if (u_base_type == 3) { // Celtic
                x_new = abs(x2 - y2);
                y_new = 2.0 * x * y;
            } else if (u_base_type == 4) { // Buffalo
                x_new = abs(x2 - y2);
                y_new = -2.0 * abs(x * y);
            } else if (u_base_type == 5) { // Mandelbrot ^3
                x_new = x * (x2 - 3.0 * y2);
                y_new = y * (3.0 * x2 - y2);
            } else if (u_base_type == 6) { // Mandelbrot ^4
                x_new = x2*x2 - 6.0*x2*y2 + y2*y2;
                y_new = 4.0 * x * y * (x2 - y2);
            } else if (u_base_type == 7) { // Mandelbrot ^5
                x_new = x * (x2*x2 - 10.0*x2*y2 + 5.0*y2*y2);
                y_new = y * (5.0*x2*x2 - 10.0*x2*y2 + y2*y2);
            } else if (u_base_type == 8) { // Burning Ship ^3
                x_new = abs(x) * (x2 - 3.0 * y2);
                y_new = abs(y) * (3.0 * x2 - y2);
            } else if (u_base_type == 9) { // Burning Ship ^4
                x_new = x2*x2 - 6.0*x2*y2 + y2*y2;
                y_new = 4.0 * abs(x * y) * (x2 - y2);
            } else if (u_base_type == 10) { // Tricorn ^3
                x_new = x * (x2 - 3.0 * y2);
                y_new = -y * (3.0 * x2 - y2);
            } else if (u_base_type == 11) { // Tricorn ^4
                x_new = x2*x2 - 6.0*x2*y2 + y2*y2;
                y_new = -4.0 * x * y * (x2 - y2);
            }
            
            z.x = x_new + c.x;
            z.y = y_new + c.y;
            
            x2 = z.x * z.x;
            y2 = z.y * z.y;
            iter += 1.0;
        }
        
        if (iter < max_iter_f) {
            float modulusSq = x2 + y2;
            float log2 = 0.6931471805599453;
            float logZn = log(modulusSq) / 2.0;
            float nu = log(logZn / log2) / log2;
            float smoothI = iter + 1.0 - nu;
            
            float val = smoothI / max_iter_f;
            val = sqrt(val);
            
            float scaledVal = val * 4.0; 
            int idx = int(scaledVal);
            float t = fract(scaledVal);
            
            vec3 color1 = u_palette[0];
            vec3 color2 = u_palette[1];
            
            if (idx == 0) { color1 = u_palette[0]; color2 = u_palette[1]; }
            else if (idx == 1) { color1 = u_palette[1]; color2 = u_palette[2]; }
            else if (idx == 2) { color1 = u_palette[2]; color2 = u_palette[3]; }
            else if (idx >= 3) { color1 = u_palette[3]; color2 = u_palette[4]; }
            
            vec3 finalColor = mix(color1, color2, t) / 255.0;
            gl_FragColor = vec4(finalColor, 1.0);
        } else {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        }
    }
`;

function initWebGL() {
    if (!gl) return;
    
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vsSource);
    gl.compileShader(vertexShader);
    
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fsSource);
    gl.compileShader(fragmentShader);
    
    glProgram = gl.createProgram();
    gl.attachShader(glProgram, vertexShader);
    gl.attachShader(glProgram, fragmentShader);
    gl.linkProgram(glProgram);
    
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [
        -1.0,  1.0,
         1.0,  1.0,
        -1.0, -1.0,
         1.0, -1.0,
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
}
initWebGL();

// Controls
const btnEngineWebgl = document.getElementById('btn-engine-webgl');
const btnEnginePython = document.getElementById('btn-engine-python');
const btnEngineJs = document.getElementById('btn-engine-js');

const panelJuliaControls = document.getElementById('julia-coords-section');
const sliderCre = document.getElementById('slider-julia-cre');
const sliderCim = document.getElementById('slider-julia-cim');
const valCre = document.getElementById('val-julia-cre');
const valCim = document.getElementById('val-julia-cim');

const palettePicker = document.getElementById('palette-picker');
const fractalSelect = document.getElementById('fractal-select');
const sliderIterations = document.getElementById('slider-iterations');
const valIterations = document.getElementById('val-iterations');
const sliderResolution = document.getElementById('slider-resolution');
const valResolution = document.getElementById('val-resolution');

const btnReset = document.getElementById('btn-reset');
const btnDownload = document.getElementById('btn-download');

// HUD
const hudCenter = document.getElementById('hud-val-center');
const hudZoom = document.getElementById('hud-val-zoom');
const hudTime = document.getElementById('hud-val-time');

// Setup Canvas Size
function resizeCanvas() {
    const container = viewportContainer.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    const activeScale = pixelRatio * state.resolutionScale;
    
    // Guarantee integer sizes >= 1 to prevent Safari ImageData and WebGL crashes
    const newWidth = Math.max(1, Math.floor(container.width * activeScale));
    const newHeight = Math.max(1, Math.floor(container.height * activeScale));
    
    canvas.width = newWidth;
    canvas.height = newHeight;
    
    // Set display size
    canvas.style.width = `${container.width}px`;
    canvas.style.height = `${container.height}px`;
    
    state.width = canvas.width;
    state.height = canvas.height;
    
    offscreenCanvas.width = newWidth;
    offscreenCanvas.height = newHeight;
    
    if (glCanvas) {
        glCanvas.width = newWidth;
        glCanvas.height = newHeight;
        if (gl) gl.viewport(0, 0, newWidth, newHeight);
    }
    
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

// Client-side JS Calculation Engine
function renderJS() {
    const width = state.width;
    const height = state.height;
    
    const dx = (state.xmax - state.xmin) / width;
    const dy = (state.ymax - state.ymin) / height;
    
    const escapeRadiusSq = 10000.0;
    const log2 = 0.6931471805599453;
    
    const palette = PALETTES[state.palette] || PALETTES.cyberpunk;
    const imgData = new ImageData(width, height);
    const data = imgData.data;
    
    const baseType = Math.floor(state.fractal_id / 2);
    const isJulia = state.fractal_id % 2 === 1;
    
    for (let py = 0; py < height; py++) {
        const y0 = state.ymax - py * dy;
        for (let px = 0; px < width; px++) {
            const idx = (py * width + px) * 4;
            const x0 = state.xmin + px * dx;
            
            let zx = 0, zy = 0;
            let cx = x0, cy = y0;
            if (isJulia) {
                zx = x0; zy = y0;
                cx = state.julia.cre; cy = state.julia.cim;
            }
            
            let iteration = 0;
            let zx2 = 0;
            let zy2 = 0;
            
            while (zx2 + zy2 <= escapeRadiusSq && iteration < state.iterations) {
                let x_new = 0, y_new = 0;
                let x = zx, y = zy;
                
                if (baseType === 0) { // Mandelbrot
                    x_new = zx2 - zy2; y_new = 2 * x * y;
                } else if (baseType === 1) { // Burning Ship
                    x_new = zx2 - zy2; y_new = 2 * Math.abs(x * y);
                } else if (baseType === 2) { // Tricorn
                    x_new = zx2 - zy2; y_new = -2 * x * y;
                } else if (baseType === 3) { // Celtic
                    x_new = Math.abs(zx2 - zy2); y_new = 2 * x * y;
                } else if (baseType === 4) { // Buffalo
                    x_new = Math.abs(zx2 - zy2); y_new = -2 * Math.abs(x * y);
                } else if (baseType === 5) { // Mandelbrot ^3
                    x_new = x * (zx2 - 3 * zy2); y_new = y * (3 * zx2 - zy2);
                } else if (baseType === 6) { // Mandelbrot ^4
                    x_new = zx2*zx2 - 6*zx2*zy2 + zy2*zy2; y_new = 4 * x * y * (zx2 - zy2);
                } else if (baseType === 7) { // Mandelbrot ^5
                    x_new = x * (zx2*zx2 - 10*zx2*zy2 + 5*zy2*zy2); y_new = y * (5*zx2*zx2 - 10*zx2*zy2 + zy2*zy2);
                } else if (baseType === 8) { // Burning Ship ^3
                    x_new = Math.abs(x) * (zx2 - 3 * zy2); y_new = Math.abs(y) * (3 * zx2 - zy2);
                } else if (baseType === 9) { // Burning Ship ^4
                    x_new = zx2*zx2 - 6*zx2*zy2 + zy2*zy2; y_new = 4 * Math.abs(x * y) * (zx2 - zy2);
                } else if (baseType === 10) { // Tricorn ^3
                    x_new = x * (zx2 - 3 * zy2); y_new = -y * (3 * zx2 - zy2);
                } else if (baseType === 11) { // Tricorn ^4
                    x_new = zx2*zx2 - 6*zx2*zy2 + zy2*zy2; y_new = -4 * x * y * (zx2 - zy2);
                }
                
                zx = x_new + cx;
                zy = y_new + cy;
                zx2 = zx * zx;
                zy2 = zy * zy;
                iteration++;
            }
            
            let r = 0, g = 0, b = 0;
            if (iteration < state.iterations) {
                const modulusSq = zx2 + zy2;
                if (modulusSq > 0) {
                    const logZn = Math.log(modulusSq) / 2.0;
                    const nu = Math.log(logZn / log2) / log2;
                    const smoothI = iteration + 1 - nu;
                    let val = Math.sqrt(Math.max(0, smoothI) / state.iterations);
                    const color = interpolateColorJS(val || 0, state.palette);
                    r = color[0]; g = color[1]; b = color[2];
                }
            }
            data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = 255;
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
        fractal_id: state.fractal_id,
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

function renderWebGL() {
    return new Promise((resolve) => {
        if (!gl || !glProgram) {
            console.error("WebGL not initialized");
            resolve();
            return;
        }
        
        gl.useProgram(glProgram);
        
        const positionLocation = gl.getAttribLocation(glProgram, "a_position");
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        
        gl.uniform2f(gl.getUniformLocation(glProgram, "u_resolution"), state.width, state.height);
        gl.uniform2f(gl.getUniformLocation(glProgram, "u_offset"), state.xmin, state.ymin);
        gl.uniform2f(gl.getUniformLocation(glProgram, "u_range"), state.xmax - state.xmin, state.ymax - state.ymin);
        gl.uniform2f(gl.getUniformLocation(glProgram, "u_julia_c"), state.julia.cre, state.julia.cim);
        gl.uniform1i(gl.getUniformLocation(glProgram, "u_max_iter"), state.iterations);
        
        const baseType = Math.floor(state.fractal_id / 2);
        const isJulia = state.fractal_id % 2 === 1;
        gl.uniform1i(gl.getUniformLocation(glProgram, "u_base_type"), baseType);
        gl.uniform1i(gl.getUniformLocation(glProgram, "u_is_julia"), isJulia ? 1 : 0);
        
        const palette = PALETTES[state.palette] || PALETTES.cyberpunk;
        const flatPalette = [];
        palette.forEach(color => flatPalette.push(...color));
        gl.uniform3fv(gl.getUniformLocation(glProgram, "u_palette"), new Float32Array(flatPalette));
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        offscreenCtx.drawImage(glCanvas, 0, 0);
        ctx.drawImage(offscreenCanvas, 0, 0);
        resolve();
    });
}

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
        if (state.engine === 'webgl') {
            await renderWebGL();
            renderSuccess = true;
            const endTime = performance.now();
            hudTime.textContent = `${Math.round(endTime - startTime)} ms (WebGL)`;
        } else if (state.engine === 'js') {
            renderJS();
            renderSuccess = true;
            const endTime = performance.now();
            hudTime.textContent = `${Math.round(endTime - startTime)} ms (JS)`;
        } else {
            await renderPython();
            renderSuccess = true;
            const endTime = performance.now();
            hudTime.textContent = `${Math.round(endTime - startTime)} ms (Py)`;
        }
    } catch (err) {
        console.warn('Backend failed, falling back...', err);
        try {
            renderJS();
            renderSuccess = true;
            const endTime = performance.now();
            hudTime.textContent = `${Math.round(endTime - startTime)} ms (JS Fallback)`;
        } catch (jsErr) { console.error('JS Fallback failed:', jsErr); }
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
            Object.assign(state, next);
            render();
        }
    }
}

function updateHUDValues() {
    const cx = ((state.xmin + state.xmax) / 2).toFixed(6);
    const cy = ((state.ymin + state.ymax) / 2).toFixed(6);
    hudCenter.textContent = `${cx}, ${cy}`;
    
    const currentWidth = state.xmax - state.xmin;
    const defaultWidth = 3.0;
    const zoomLevel = (defaultWidth / currentWidth).toLocaleString(undefined, { maximumFractionDigits: 1 });
    hudZoom.textContent = `${zoomLevel}x`;
}

function setEngine(engine) {
    state.engine = engine;
    btnEnginePython.classList.remove('active');
    btnEngineJs.classList.remove('active');
    btnEngineWebgl.classList.remove('active');
    if (engine === 'python') btnEnginePython.classList.add('active');
    else if (engine === 'js') btnEngineJs.classList.add('active');
    else if (engine === 'webgl') btnEngineWebgl.classList.add('active');
    render();
}

function initEvents() {
    FRACTAL_TYPES.forEach(ft => {
        const option = document.createElement('option');
        option.value = ft.id;
        option.textContent = ft.name;
        fractalSelect.appendChild(option);
    });
    fractalSelect.value = state.fractal_id;
    
    fractalSelect.addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        const matched = FRACTAL_TYPES.find(ft => ft.id === val);
        if (matched) {
            state.fractal_id = matched.id;
            if (matched.isJulia) panelJuliaControls.classList.remove('hidden');
            else panelJuliaControls.classList.add('hidden');
            resetFractalBounds();
        }
    });

    btnEngineWebgl.addEventListener('click', () => setEngine('webgl'));
    btnEnginePython.addEventListener('click', () => setEngine('python'));
    btnEngineJs.addEventListener('click', () => setEngine('js'));
    
    sliderCre.addEventListener('input', (e) => {
        state.julia.cre = parseFloat(e.target.value);
        valCre.textContent = state.julia.cre.toFixed(3);
        render();
    });
    sliderCim.addEventListener('input', (e) => {
        state.julia.cim = parseFloat(e.target.value);
        valCim.textContent = state.julia.cim.toFixed(3);
        render();
    });
    
    sliderIterations.addEventListener('input', (e) => {
        state.iterations = parseInt(e.target.value);
        valIterations.textContent = state.iterations;
        render();
    });
    
    sliderResolution.addEventListener('input', (e) => {
        state.resolutionScale = parseInt(e.target.value) / 100.0;
        valResolution.textContent = `${e.target.value}%`;
        resizeCanvas();
        debouncedRender();
    });
    
    palettePicker.addEventListener('click', (e) => {
        const card = e.target.closest('.palette-card');
        if (!card) return;
        
        document.querySelectorAll('.palette-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        
        state.palette = card.dataset.palette;
        render();
    });
    
    btnReset.addEventListener('click', resetFractalBounds);
    
    btnDownload.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `fractal_${state.fractal_id}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
    
    let isDragging = false;
    let startX, startY;
    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX; startY = e.clientY;
    });
    window.addEventListener('mouseup', () => { isDragging = false; });
    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const rect = canvas.getBoundingClientRect();
        const dx = e.clientX - startX; const dy = e.clientY - startY;
        const complexWidth = state.xmax - state.xmin;
        const complexHeight = state.ymax - state.ymin;
        const shiftX = (dx / rect.width) * complexWidth;
        const shiftY = (dy / rect.height) * complexHeight;
        state.xmin -= shiftX; state.xmax -= shiftX;
        state.ymin += shiftY; state.ymax += shiftY;
        startX = e.clientX; startY = e.clientY;
        updateHUDValues();
        drawPreview();
        debouncedRender();
    });
    
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
        const complexWidth = state.xmax - state.xmin; const complexHeight = state.ymax - state.ymin;
        
        // Calculate the ratio based on CSS rect layout size, not internal resolution
        const ratioX = mouseX / rect.width; 
        const ratioY = mouseY / rect.height;
        
        const mouseRe = state.xmin + ratioX * complexWidth;
        const mouseIm = state.ymax - ratioY * complexHeight;
        
        const zoomFactor = e.deltaY < 0 ? 0.85 : 1.15;
        const newWidth = complexWidth * zoomFactor; const newHeight = complexHeight * zoomFactor;
        
        state.xmin = mouseRe - ratioX * newWidth;
        state.xmax = mouseRe + (1 - ratioX) * newWidth;
        state.ymin = mouseIm - (1 - ratioY) * newHeight;
        state.ymax = mouseIm + ratioY * newHeight;
        
        updateHUDValues();
        const isJulia = state.fractal_id % 2 === 1;
        if (!isJulia) drawPreview();
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
