const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');
const lines = code.split('\n');
const start = lines.findIndex(l => l.includes('const executeSell = async'));
let braces = 0;
for (let i = start; i < lines.length; i++) {
  const line = lines[i];
  braces += (line.match(/\{/g) || []).length;
  braces -= (line.match(/\}/g) || []).length;
  if (braces === 0) {
    console.log(`executeSell ends at line ${i+1}`);
    break;
  }
}
