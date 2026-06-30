export const Tricorn = {
    id: 2,
    name: 'Tricorn',
    juliaName: 'Tricorn Julia',
    
    glsl: `
        float y_conj = -y;
        if (u_power == 2.0) {
            x_new = x2 - y_conj*y_conj;
            y_new = 2.0 * x * y_conj;
        } else {
            float r = sqrt(x2 + y_conj*y_conj);
            float theta = atan(y_conj, x);
            float rn = pow(r, u_power);
            x_new = rn * cos(u_power * theta);
            y_new = rn * sin(u_power * theta);
        }
    `,
    
    calcJS: function(x, y, zx2, zy2, power, out) {
        const y_conj = -y;
        if (power === 2.0) {
            out[0] = zx2 - y_conj*y_conj;
            out[1] = 2.0 * x * y_conj;
        } else {
            const r = Math.sqrt(zx2 + y_conj*y_conj);
            const theta = Math.atan2(y_conj, x);
            const rn = Math.pow(r, power);
            out[0] = rn * Math.cos(power * theta);
            out[1] = rn * Math.sin(power * theta);
        }
        out[2] = 0;
    }
};
