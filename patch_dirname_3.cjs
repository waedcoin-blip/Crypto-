const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const target = `let _filename = '';
let _dirname = process.cwd();
try {
  _filename = typeof __filename !== 'undefined' ? __filename : (typeof import.meta !== 'undefined' && import.meta.url ? fileURLToPath(import.meta.url) : '');
  _dirname = typeof __dirname !== 'undefined' ? __dirname : (_filename ? path.dirname(_filename) : process.cwd());
} catch(e) {}`;

const replacement = `let _filename = '';
let _dirname = process.cwd();
try {
  if (typeof __filename !== 'undefined') {
    _filename = __filename;
  } else if (typeof import.meta !== 'undefined' && import.meta.url) {
    try {
        _filename = fileURLToPath(import.meta.url);
    } catch(e) {}
  }
  
  if (typeof __dirname !== 'undefined') {
    _dirname = __dirname;
  } else if (_filename) {
    _dirname = path.dirname(_filename);
  }
} catch(e) {}`;

code = code.replace(target, replacement);
fs.writeFileSync('server.ts', code);
console.log('patched dirname 3');
