# Quantum Fractals Explorer - Context for Gemini

Welcome to the **Quantum Fractals Explorer**! This file serves as a quick context reference and guide for me (Gemini) and for your own readability when you come back to the project.

## 🌟 Project Overview
An interactive, high-performance fractal generator. It renders complex mathematical sets with beautiful gradients, zooming capabilities, and fluid panning.

## 🏗️ Architecture & Stack
- **Frontend Core**: Vanilla HTML5, CSS3, and JavaScript.
- **Rendering**: Uses HTML5 `<canvas>` and raw `ImageData` byte manipulation for ultra-fast drawing, avoiding heavy image decoding on the client side.
- **Styling**: Custom CSS with glassmorphism effects, a dark/neon theme, and smooth UI transitions.
- **Math Engine**: Computes Mandelbrot, Julia, and Burning Ship fractals (historically this project was designed with a Python/Numba FastAPI backend as mentioned in the original README, though the current web client lives right here in the root).

## 📁 Key Files
- `index.html`: The main entry point containing the UI layout, canvas, and control panels.
- `styles.css`: All styling, including the dynamic glassmorphic panels and responsive layout.
- `app.js`: The core frontend logic for the canvas drawing loop, coordinate math (zoom/pan), event listeners, and data fetching.
- `models/`: Directory for any local models or additional data structures.

## 🚀 How to Run (Frontend)
Since the frontend files are in the root directory, you can serve them using any static server. For example:
```bash
# Using Python
python -m http.server 8080

# Using Node.js
npx serve .
```
*(Currently, your app is running locally at `http://localhost:8080/`)*

## 🧠 My Role (Gemini)
I have access to your workspace and the browser. You can ask me to:
- **Refactor or Optimize**: Improve the performance of the canvas rendering loop in `app.js`.
- **Style the UI**: Enhance the glassmorphic aesthetics or add new CSS animations in `styles.css`.
- **Add Features**: Implement new fractal types, color palettes, or UI controls.
- **Debug**: Fix issues with panning, zooming, or API connections.

---
*Feel free to update this file as the project evolves!*
