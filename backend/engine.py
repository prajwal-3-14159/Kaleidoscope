import numpy as np
from numba import jit, prange

# Define color stops for our premium palettes.
# Each palette consists of 5 RGB colors (values 0-255).
# Using 32-bit floats for stops to keep math fast on Apple Silicon.
PALETTES = {
    # 0: Cyberpunk (Neon pink, purple, dark blue, cyan, black)
    "cyberpunk": np.array([
        [10, 10, 30],      # Dark space
        [0, 128, 255],     # Neon Cyan
        [128, 0, 255],     # Purple
        [255, 0, 128],     # Neon Pink
        [255, 230, 255]    # Bright White-pink
    ], dtype=np.float32),
    
    # 1: Solarized Fire (Deep black, dark red, orange, yellow, white)
    "fire": np.array([
        [0, 0, 0],         # Black
        [120, 0, 0],       # Deep Red
        [230, 90, 0],      # Bright Orange
        [255, 200, 0],     # Yellow
        [255, 255, 200]    # White-yellow
    ], dtype=np.float32),
    
    # 2: Deep Ocean (Dark blue, teal, light green, soft yellow, white)
    "ocean": np.array([
        [2, 8, 24],        # Deep Abyss
        [0, 76, 153],      # Slate Blue
        [0, 153, 153],     # Teal
        [102, 255, 178],   # Mint Green
        [255, 255, 255]    # White foam
    ], dtype=np.float32),

    # 3: Monochromatic Slate (Dark slate gray, metallic blue, light silver)
    "slate": np.array([
        [15, 23, 42],      # Dark Slate
        [51, 65, 85],      # Steel Blue-gray
        [100, 116, 139],   # Medium Gray
        [148, 163, 184],   # Light Slate
        [241, 245, 249]    # Off-white
    ], dtype=np.float32)
}

# Convert palettes to a structured array for easy Numba indexing.
PALETTE_NAMES = list(PALETTES.keys())
PALETTE_DATA = np.stack([PALETTES[name] for name in PALETTE_NAMES]).astype(np.float32)

@jit(nopython=True, cache=True)
def interpolate_color(val, palette_idx):
    """
    Interpolates a value between 0.0 and 1.0 using the selected palette.
    """
    # Palette data shape: (num_palettes, num_stops, 3)
    stops = PALETTE_DATA[palette_idx]
    num_stops = len(stops)
    
    # Scale val to the range of stops [0, num_stops - 1]
    scaled_val = val * (num_stops - 1)
    
    # Get the bounding indices
    idx1 = int(scaled_val)
    if idx1 >= num_stops - 1:
        return int(stops[-1][0]), int(stops[-1][1]), int(stops[-1][2])
    if idx1 < 0:
        return int(stops[0][0]), int(stops[0][1]), int(stops[0][2])
        
    idx2 = idx1 + 1
    t = scaled_val - idx1
    
    # Linear interpolation
    r = stops[idx1][0] + t * (stops[idx2][0] - stops[idx1][0])
    g = stops[idx1][1] + t * (stops[idx2][1] - stops[idx1][1])
    b = stops[idx1][2] + t * (stops[idx2][2] - stops[idx1][2])
    
    return int(r), int(g), int(b)

@jit(nopython=True, fastmath=True, parallel=True, cache=True)
def generate_fractal_rgba(
    width, height, 
    xmin, xmax, ymin, ymax, 
    max_iter, 
    fractal_type, 
    palette_idx, 
    julia_cre, julia_cim
):
    """
    Numba parallelized generator that writes directly into a pre-allocated 
    1D/3D Uint8 array to avoid garbage collection and memory copies on Apple Silicon.
    """
    # Create target array for raw RGBA bytes. 
    # Shape: (height, width, 4) -> R, G, B, A
    img_data = np.empty((height, width, 4), dtype=np.uint8)
    
    # Scale factors
    dx = (xmax - xmin) / width
    dy = (ymax - ymin) / height
    
    # Escape radius squared (using R = 100 for smoother coloring)
    escape_radius_sq = 10000.0
    log_2 = 0.6931471805599453
    log_escape = 2.302585092994046 # ln(escape_radius) = ln(100) = 4.60517 / 2 = 2.302585
    
    # Parallel execution over screen rows
    for py in prange(height):
        y0 = ymax - py * dy  # Flip Y so it goes from top to bottom
        for px in range(width):
            x0 = xmin + px * dx
            
            # Initialize complex variables
            if fractal_type == 0:  # Mandelbrot
                zx, zy = 0.0, 0.0
                cx, cy = x0, y0
            elif fractal_type == 1:  # Julia
                zx, zy = x0, y0
                cx, cy = julia_cre, julia_cim
            else:  # Burning Ship (fractal_type == 2)
                zx, zy = 0.0, 0.0
                cx, cy = x0, y0
                
            iteration = 0
            zx2 = 0.0
            zy2 = 0.0
            
            # Core Escape Time loop
            while zx2 + zy2 <= escape_radius_sq and iteration < max_iter:
                if fractal_type == 2:  # Burning Ship: z = (|Re(z)| + i|Im(z)|)^2 + c
                    zy = abs(2.0 * zx * zy) + cy
                    zx = zx2 - zy2 + cx
                else:  # Mandelbrot & Julia: z = z^2 + c
                    zy = 2.0 * zx * zy + cy
                    zx = zx2 - zy2 + cx
                    
                zx2 = zx * zx
                zy2 = zy * zy
                iteration += 1
                
            # Coloring calculation
            if iteration < max_iter:
                # Smooth coloring using continuous potential
                modulus_sq = zx2 + zy2
                # Ensure no log of zero
                if modulus_sq > 0:
                    log_zn = np.log(modulus_sq) / 2.0
                    nu = np.log(log_zn / log_2) / log_2
                    # Smooth iteration value
                    smooth_i = iteration + 1 - nu
                else:
                    smooth_i = float(iteration)
                
                # Normalize color value (0.0 to 1.0) with logarithmic scaling to reveal details
                val = smooth_i / max_iter
                # Apply a slight curve to make colors pop in high-detail areas
                val = np.sqrt(val)
                r, g, b = interpolate_color(val, palette_idx)
            else:
                # Inside the set is solid dark
                r, g, b = 0, 0, 0
                
            # Write directly to array
            img_data[py, px, 0] = r
            img_data[py, px, 1] = g
            img_data[py, px, 2] = b
            img_data[py, px, 3] = 255 # Alpha channel (opaque)
            
    return img_data
