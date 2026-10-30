import { state, render, adjustAspectRatio, resetFractalBounds, updateHUDValues } from './app.js';

let isBenchmarking = false;
let benchmarkStartTime = 0;
let lastFrameTime = 0;
let totalFrames = 0;
let sceneIndex = 0;
let animationFrameId = null;
let highestScore = 0;

const TOTAL_TIME = 180000; // 3 minutes = 180,000 ms

const SCENES = [
    {
        // 0-30s: Mandelbrot Zoom
        duration: 30000,
        setup: () => {
            state.fractal_id = 0; // Mandelbrot
            state.power = 2.0;
            state.palette = 'cyberpunk';
            state.iterations = 300;
            resetFractalBounds();
        },
        update: (progress) => {
            const targetX = -0.743643887037151;
            const targetY = 0.131825904205330;
            
            const startW = 3.0;
            const endW = 0.00001;
            const currentW = startW * Math.pow(endW / startW, progress);
            
            const startCx = -0.5;
            const startCy = 0.0;
            const cx = startCx + (targetX - startCx) * Math.pow(progress, 0.5); 
            const cy = startCy + (targetY - startCy) * Math.pow(progress, 0.5);
            
            state.xmin = cx - currentW / 2;
            state.xmax = cx + currentW / 2;
            const h = currentW / (state.width / state.height);
            state.ymin = cy - h / 2;
            state.ymax = cy + h / 2;
        }
    },
    {
        // 30-60s: Julia Morph
        duration: 30000,
        setup: () => {
            state.fractal_id = 1; // Julia
            state.power = 2.0;
            state.palette = 'fire';
            state.iterations = 200;
            resetFractalBounds();
        },
        update: (progress) => {
            const angle = progress * Math.PI * 4;
            const radius = 0.7885;
            state.julia.cre = radius * Math.cos(angle);
            state.julia.cim = radius * Math.sin(angle);
        }
    },
    {
        // 60-90s: Burning Ship Zoom
        duration: 30000,
        setup: () => {
            state.fractal_id = 4; // Burning Ship
            state.power = 2.0;
            state.palette = 'ocean';
            state.iterations = 400;
            resetFractalBounds();
        },
        update: (progress) => {
            const targetX = -1.75;
            const targetY = -0.05;
            
            const startW = 4.0;
            const endW = 0.01;
            const currentW = startW * Math.pow(endW / startW, progress);
            
            const startCx = -0.5;
            const startCy = 0.0;
            const cx = startCx + (targetX - startCx) * Math.pow(progress, 0.5);
            const cy = startCy + (targetY - startCy) * Math.pow(progress, 0.5);
            
            state.xmin = cx - currentW / 2;
            state.xmax = cx + currentW / 2;
            const h = currentW / (state.width / state.height);
            state.ymin = cy - h / 2;
            state.ymax = cy + h / 2;
        }
    },
    {
        // 90-120s: Tricorn Morph Power
        duration: 30000,
        setup: () => {
            state.fractal_id = 12; // Tricorn (base id 6, 6*2=12)
            state.palette = 'slate';
            state.iterations = 150;
            resetFractalBounds();
        },
        update: (progress) => {
            state.power = 2.0 + Math.sin(progress * Math.PI) * 4.0;
        }
    },
    {
        // 120-150s: Celtic fractal
        duration: 30000,
        setup: () => {
            state.fractal_id = 8; // Celtic (base id 4, 4*2=8)
            state.power = 2.0;
            state.palette = 'cyberpunk';
            state.iterations = 250;
            resetFractalBounds();
        },
        update: (progress) => {
            const startW = 3.0;
            const endW = 0.05;
            const currentW = startW * Math.pow(endW / startW, Math.sin(progress * Math.PI));
            
            const cx = -0.5;
            const cy = 0.0;
            
            state.xmin = cx - currentW / 2;
            state.xmax = cx + currentW / 2;
            const h = currentW / (state.width / state.height);
            state.ymin = cy - h / 2;
            state.ymax = cy + h / 2;
            
            if (progress < 0.25) state.palette = 'cyberpunk';
            else if (progress < 0.5) state.palette = 'fire';
            else if (progress < 0.75) state.palette = 'ocean';
            else state.palette = 'slate';
        }
    },
    {
        // 150-180s: Buffalo Julia
        duration: 30000,
        setup: () => {
            state.fractal_id = 17; // Buffalo Julia (base id 8, 8*2+1=17)
            state.power = 2.0;
            state.palette = 'fire';
            state.iterations = 200;
            resetFractalBounds();
        },
        update: (progress) => {
            const angle = progress * Math.PI * 2;
            const radius = 0.5;
            state.julia.cre = radius * Math.cos(angle);
            state.julia.cim = radius * Math.sin(angle);
        }
    }
];

export function initBenchmark() {
    const btnStart = document.getElementById('btn-start-benchmark');
    if (btnStart) {
        btnStart.addEventListener('click', startBenchmark);
    }
    const btnStop = document.getElementById('btn-stop-benchmark');
    if (btnStop) {
        btnStop.addEventListener('click', endBenchmark);
    }
    const btnClose = document.getElementById('btn-close-benchmark');
    if (btnClose) {
        btnClose.addEventListener('click', closeScoreModal);
    }
    
    // Load highest score
    const savedScore = localStorage.getItem('fractal_benchmark_highest');
    if (savedScore) {
        highestScore = parseInt(savedScore, 10);
        document.getElementById('bench-highest-val').textContent = highestScore.toLocaleString();
    }
}

let savedState = null;

async function startBenchmark() {
    if (isBenchmarking) return;
    isBenchmarking = true;
    
    // Save current user state
    savedState = JSON.parse(JSON.stringify(state));
    
    totalFrames = 0;
    sceneIndex = 0;
    
    document.getElementById('btn-start-benchmark').style.display = 'none';
    document.getElementById('btn-stop-benchmark').style.display = 'block';
    
    document.getElementById('controls-panel').style.opacity = '0.3';
    document.getElementById('controls-panel').style.pointerEvents = 'none';
    
    benchmarkStartTime = performance.now();
    lastFrameTime = benchmarkStartTime;
    
    SCENES[0].setup();
    
    requestAnimationFrame(benchmarkLoop);
}

async function benchmarkLoop(now) {
    if (!isBenchmarking) return;
    
    const elapsed = now - benchmarkStartTime;
    if (elapsed >= TOTAL_TIME || sceneIndex >= SCENES.length) {
        endBenchmark();
        return;
    }
    
    // Calculate current scene bounds
    let sceneStartTime = 0;
    for (let i = 0; i < sceneIndex; i++) {
        sceneStartTime += SCENES[i].duration;
    }
    
    // Check if we advanced a scene
    if (elapsed > sceneStartTime + SCENES[sceneIndex].duration) {
        sceneIndex++;
        if (sceneIndex < SCENES.length) {
            SCENES[sceneIndex].setup();
        }
    }
    
    if (sceneIndex < SCENES.length) {
        const scene = SCENES[sceneIndex];
        const sceneElapsed = elapsed - sceneStartTime;
        const progress = Math.min(1.0, sceneElapsed / scene.duration);
        
        scene.update(progress);
        
        // Blockingly render and increment frames
        await render();
        totalFrames++;
        
        // Update HUD Stats
        const frameDiff = now - lastFrameTime;
        // avoid divide by zero if frames are super fast
        const fps = frameDiff > 0 ? Math.round(1000 / frameDiff) : 60;
        lastFrameTime = now;
        
        const remaining = TOTAL_TIME - elapsed;
        const seconds = Math.floor(remaining / 1000) % 60;
        const minutes = Math.floor(remaining / 60000);
        
        document.getElementById('bench-time-val').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        document.getElementById('bench-fps-val').textContent = fps;
        
        updateHUDValues();
    }
    
    animationFrameId = requestAnimationFrame(benchmarkLoop);
}

function endBenchmark() {
    isBenchmarking = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    document.getElementById('btn-stop-benchmark').style.display = 'none';
    document.getElementById('btn-start-benchmark').style.display = 'block';
    
    document.getElementById('controls-panel').style.opacity = '1';
    document.getElementById('controls-panel').style.pointerEvents = 'auto';
    
    // Restore state
    if (savedState) {
        Object.assign(state, savedState);
        resetFractalBounds();
        updateHUDValues();
    }
    
    // Calculate Score based on total pixels processed
    const pixelCount = state.width * state.height;
    const baseScore = totalFrames * (pixelCount / 1000000); // megapixel-frames
    const finalScore = Math.round(baseScore * 42); // aesthetic multiplier
    
    if (finalScore > highestScore) {
        highestScore = finalScore;
        localStorage.setItem('fractal_benchmark_highest', highestScore);
        document.getElementById('bench-highest-val').textContent = highestScore.toLocaleString();
    }
    
    document.getElementById('benchmark-score-val').textContent = finalScore.toLocaleString();
    document.getElementById('benchmark-modal').classList.add('active');
}

function closeScoreModal() {
    document.getElementById('benchmark-modal').classList.remove('active');
}
