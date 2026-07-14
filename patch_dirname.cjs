const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const target = `const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);`;

const replacement = `const _filename = typeof __filename !== 'undefined' ? __filename : (typeof import.meta !== 'undefined' && import.meta.url ? fileURLToPath(import.meta.url) : '');
const _dirname = typeof __dirname !== 'undefined' ? __dirname : (_filename ? path.dirname(_filename) : process.cwd());`;

code = code.replace(target, replacement);
fs.writeFileSync('server.ts', code);
console.log('patched dirname');
