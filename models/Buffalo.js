export const Buffalo = {
    id: 4,
    name: 'Buffalo',
    juliaName: 'Buffalo Julia',
    
    glsl: `
        float b_ax = abs(x);
        float b_ay = abs(y);
        if (u_power == 2.0) {
            x_new = abs(b_ax*b_ax - b_ay*b_ay);
            y_new = -2.0 * b_ax * b_ay;
        } else {
            float r = sqrt(b_ax*b_ax + b_ay*b_ay);
            float theta = atan(b_ay, b_ax);
            float rn = pow(r, u_power);
            x_new = abs(rn * cos(u_power * theta));
            y_new = -abs(rn * sin(u_power * theta));
        }
    `,
    
    calcJS: function(x, y, zx2, zy2, power, out) {
        const ax = Math.abs(x);
        const ay = Math.abs(y);
        if (power === 2.0) {
            out[0] = Math.abs(ax*ax - ay*ay);
            out[1] = -2.0 * ax * ay;
        } else {
            const r = Math.sqrt(ax*ax + ay*ay);
            const theta = Math.atan2(ay, ax);
            const rn = Math.pow(r, power);
            out[0] = Math.abs(rn * Math.cos(power * theta));
            out[1] = -Math.abs(rn * Math.sin(power * theta));
        }
        out[2] = 0;
    }
};
