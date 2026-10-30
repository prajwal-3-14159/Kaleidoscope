import fs from 'fs';
const appJS = fs.readFileSync('app.js', 'utf8');
const benchJS = fs.readFileSync('benchmark.js', 'utf8');

// Check if gl.drawArrays exists in app.js
if (appJS.includes("gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);")) {
    console.log("Draw Arrays is present");
}

// Check if renderWebGL resolves
if (appJS.includes("resolve();")) {
    console.log("resolve is present in renderWebGL");
}
