import fs from 'node:fs';
import path from 'node:path';
const roots = ['index.html', 'src', 'server.ts', 'server', 'api'];
const forbidden = [/Object\.defineProperty\([\s\S]{0,500}fetch/, /(?:window|globalThis|Window\.prototype)\.fetch\s*=/];
const files=[];
function walk(p){ if(!fs.existsSync(p)) return; const st=fs.statSync(p); if(st.isDirectory()) for(const e of fs.readdirSync(p)) walk(path.join(p,e)); else if(/\.(html|ts|tsx|js|mjs|cjs)$/.test(p)) files.push(p); }
for(const r of roots) walk(r);
const violations=[]; for(const f of files){ const s=fs.readFileSync(f,'utf8'); if(forbidden.some(re=>re.test(s))) violations.push(f); }
if(violations.length){ console.error('GLOBAL_FETCH_PATCH_VIOLATION:',violations.join(', ')); process.exit(1); }
console.log('PASS: no global fetch monkey-patching detected');
