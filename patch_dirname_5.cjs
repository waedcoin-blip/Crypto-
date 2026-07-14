const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const target = `let _filename = '';
let _dirname = process.cwd();
try {
  if (typeof __filename !== 'undefined') {
    _filename = __filename;
  }
  if (typeof __dirname !== 'undefined') {
    _dirname = __dirname;
  }
} catch(e) {}`;

const replacement = `const _filename = __filename || '';
const _dirname = __dirname || process.cwd();`;

code = code.replace(target, replacement);
code = code.replace(`import { fileURLToPath } from "url";`, `// import { fileURLToPath } from "url";`);
fs.writeFileSync('server.ts', code);
console.log('patched dirname 5');
