export const BurningShip = {
    id: 1,
    name: 'Burning Ship',
    juliaName: 'Burning Ship Julia',
    
    glsl: `
        float ax = abs(x);
        float ay = abs(y);
        if (u_power == 2.0) {
            x_new = ax*ax - ay*ay;
            y_new = 2.0 * ax * ay;
        } else {
            float r = sqrt(ax*ax + ay*ay);
            float theta = atan(ay, ax);
            float rn = pow(r, u_power);
            x_new = rn * cos(u_power * theta);
            y_new = rn * sin(u_power * theta);
        }
    `,
    
    calcJS: function(x, y, zx2, zy2, power, out) {
        const ax = Math.abs(x);
        const ay = Math.abs(y);
        if (power === 2.0) {
            out[0] = ax*ax - ay*ay;
            out[1] = 2.0 * ax * ay;
        } else {
            const r = Math.sqrt(ax*ax + ay*ay);
            const theta = Math.atan2(ay, ax);
            const rn = Math.pow(r, power);
            out[0] = rn * Math.cos(power * theta);
            out[1] = rn * Math.sin(power * theta);
        }
        out[2] = 0;
    }
};
