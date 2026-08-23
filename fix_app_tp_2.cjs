const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `curPnLPercent > (position.tpPct ?? minTakeProfit) ? (position.entryPriceSol || 0.1) : undefined,
        curPnLPercent > (position.tpPct ?? minTakeProfit) ? (position.tpPct ?? minTakeProfit) : undefined,`;

const repl = `curPnLPercent > minTakeProfit ? (position.entryPriceSol || 0.1) : undefined,
        curPnLPercent > minTakeProfit ? minTakeProfit : undefined,`;

if (code.includes(target)) {
  code = code.replace(target, repl);
  fs.writeFileSync('src/App.tsx', code);
  console.log('App.tsx TP part 2 updated successfully.');
} else {
  console.log('Target not found in App.tsx TP part 2');
}
