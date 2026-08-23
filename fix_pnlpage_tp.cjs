const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const t3 = `               tpPct: existing?.tpPct ?? (configRef.current.minTakeProfit || 25),
               slPct: existing?.slPct ?? (configRef.current.stopLossPct || 15),`;

if (code.includes(t3)) {
  code = code.replace(t3, '');
} else {
  console.log('t3 not found in PnLPage.tsx');
}

fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log('PnLPage.tsx TP part updated successfully.');
