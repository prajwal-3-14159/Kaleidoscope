import uvicorn
from fastapi import FastAPI, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import sys

# Ensure parent directory is in sys.path so we can import backend.engine easily
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.engine import generate_fractal_rgba, PALETTE_NAMES

app = FastAPI(title="Fractals Explorer API")

# Enable CORS so our frontend can make API calls from any local origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRACTAL_TYPES = {
    "mandelbrot": 0,
    "julia": 1,
    "ship": 2
}

@app.get("/api/fractal")
def get_fractal(
    width: int = Query(800, ge=1, le=4000),
    height: int = Query(600, ge=1, le=4000),
    xmin: float = Query(-2.0),
    xmax: float = Query(1.0),
    ymin: float = Query(-1.5),
    ymax: float = Query(1.5),
    max_iter: int = Query(150, ge=1, le=5000),
    type: str = Query("mandelbrot"),
    palette: str = Query("cyberpunk"),
    julia_cre: float = Query(-0.7),
    julia_cim: float = Query(0.27015)
):
    # Resolve type and palette indices
    type_idx = FRACTAL_TYPES.get(type.lower(), 0)
    
    if palette.lower() in PALETTE_NAMES:
        palette_idx = PALETTE_NAMES.index(palette.lower())
    else:
        palette_idx = 0
        
    # Generate the raw RGBA pixels using Numba compiled engine
    img_data = generate_fractal_rgba(
        width, height,
        xmin, xmax, ymin, ymax,
        max_iter,
        type_idx,
        palette_idx,
        julia_cre, julia_cim
    )
    
    # Return the raw binary array directly.
    # On the frontend, we can convert it into an ImageData buffer instantly,
    # completely bypassing slow PNG/JPEG encoding on the Apple Silicon backend.
    raw_bytes = img_data.tobytes()
    
    return Response(content=raw_bytes, media_type="application/octet-stream")

@app.get("/api/palettes")
def get_palettes():
    return {"palettes": PALETTE_NAMES}

# Serve frontend files if they are located under the frontend directory
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
