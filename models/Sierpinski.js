export const Sierpinski = {
    id: 5,
    name: 'Sierpinski Triangle',
    juliaName: 'Sierpinski Julia', // Though Sierpinski doesn't really have a standard Julia set in this context
    
    glsl: `
        int sx = int(abs(x) * 100.0);
        int sy = int(abs(y) * 100.0);
        
        // WebGL 1.0 does not natively support bitwise operators in all environments
        // But assuming we have OES_standard_derivatives or WebGL2, we could use them.
        // Actually, bitwise AND is not supported in GLSL ES 1.0. 
        // We handle this by using a modulo trick for Sierpinski in WebGL,
        // OR we just use a fallback. 
        // For now, we use a simple bitwise hack if available, or just a dummy fallback.
        // Wait, earlier we established we can't easily do bitwise in WebGL 1.0. 
        // Let's implement a float-based Sierpinski approximation for WebGL 1.0:
        
        float mod_x = mod(abs(x) * 100.0, 2.0);
        float mod_y = mod(abs(y) * 100.0, 2.0);
        
        // Rough approximation since bitwise & is illegal in strict WebGL 1.0
        if (mod_x >= 1.0 && mod_y >= 1.0) {
            // Force escape
            x_new = 1000.0;
            y_new = 1000.0;
        } else {
            x_new = x * 2.0;
            y_new = y * 2.0;
        }
    `,
    
    calcJS: function(x, y, zx2, zy2, power, out) {
        if ((Math.floor(Math.abs(x) * 100) & Math.floor(Math.abs(y) * 100)) !== 0) {
            out[2] = 1; // Force escape
        } else {
            out[0] = x * 2.0;
            out[1] = y * 2.0;
            out[2] = 0;
        }
    }
};
