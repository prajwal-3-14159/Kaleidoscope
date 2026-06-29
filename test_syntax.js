const fs = require('fs');
const js = fs.readFileSync('frontend/app.js', 'utf8');
try {
  new Function(js);
  console.log("Syntax is OK");
} catch (e) {
  console.log("Syntax Error:", e);
}
