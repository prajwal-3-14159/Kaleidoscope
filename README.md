# Quantum Fractals Explorer

An interactive, high-performance, and beautifully styled fractal generator optimized for **Apple Silicon** macOS systems. 

This project uses a backend Python math engine compiled down to native machine code on-the-fly using **Numba**, coupled with an asynchronous **FastAPI** API, rendering inside a custom HTML5 canvas web page.

---

## ✨ Features & Optimizations

- **Apple Silicon Native Compilation**: Leverages `Numba` JIT compiler to run loop-heavy calculations using ARM64 NEON vector instructions and parallelizes execution using all available CPU cores.
- **Ultra-low Latency Binary Buffer Transfer**: Bypasses heavy single-threaded PNG encoding on the server and image decoding on the client. The backend directly streams raw RGBA bytes as an octet-stream, which the frontend mounts instantly into canvas `ImageData`.
- **Smooth Gradient Anti-Banding**: Implements the continuous potential normalization algorithm to eliminate harsh borders and produce smooth, elegant gradients.
- **Fluid UI Exploration**: Real-time click-and-drag panning and scroll-wheel zoom (centered at mouse coordinates).
- **Supports Multiple Fractal Sets**:
  - **Mandelbrot Set**
  - **Julia Set** (interactive sliders to tweak parameters)
  - **Burning Ship Fractal**
- **Dynamic Color Palettes**: Choose from *Cyberpunk Neon*, *Solarized Fire*, *Deep Ocean*, or *Monochromatic Slate*.
- **Snapshot Exporter**: Save your current zoom viewport instantly to a high-resolution PNG file.

---

## 🛠️ Requirements & Installation

1. Make sure you have **Python 3.9 - 3.12** installed (which supports Numba).
2. Install the optimized dependencies:
   ```bash
   pip install -r requirements.txt
   ```

---

## 🚀 Running the App

1. Run the FastAPI development server:
   ```bash
   python -m backend.main
   ```
2. Open your browser and navigate to:
   [http://127.0.0.1:8000](http://127.0.0.1:8000)

---

## 📁 File Structure

- `backend/engine.py`: Numba parallelized JIT calculations and color mapping interpolation.
- `backend/main.py`: FastAPI server setup serving static files and exposing raw binary streaming endpoint.
- `frontend/index.html`: Responsive layout and user control dashboard.
- `frontend/styles.css`: Glassmorphic styling system, customized ranges, colors, and layout.
- `frontend/app.js`: High-performance canvas drawing loop, coordinate zoom/pan math, and API interface.
