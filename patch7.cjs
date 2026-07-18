const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf-8');

code = code.replaceAll(`if (quote && pos.amountLamports && pos.amount) {`, `if (typeof quote !== 'undefined' && quote && pos.amountLamports && pos.amount) {`);

fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log("Patched 7");
