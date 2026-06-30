export const Mandelbrot = {
    id: 0,
    name: 'Mandelbrot',
    juliaName: 'Julia Set',
    
    glsl: `
        if (u_power == 2.0) {
            x_new = x2 - y2;
            y_new = 2.0 * x * y;
        } else {
            float r = sqrt(x2 + y2);
            float theta = atan(y, x);
            float rn = pow(r, u_power);
            x_new = rn * cos(u_power * theta);
            y_new = rn * sin(u_power * theta);
        }
    `,
    
    calcJS: function(x, y, zx2, zy2, power, out) {
        if (power === 2.0) {
            out[0] = zx2 - zy2; 
            out[1] = 2.0 * x * y;
        } else {
            const r = Math.sqrt(zx2 + zy2);
            const theta = Math.atan2(y, x);
            const rn = Math.pow(r, power);
            out[0] = rn * Math.cos(power * theta);
            out[1] = rn * Math.sin(power * theta);
        }
        out[2] = 0;
    }
};
