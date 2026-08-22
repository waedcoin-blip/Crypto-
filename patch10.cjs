const fs = require('fs');
let content = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const regex = /let pnl = trade\.pnlPct \|\| 0;/g;
const replacement = `let pnl = (trade.buyAmountSol && trade.buyAmountSol > 0) ? (((trade.sellAmountSol || 0) - trade.buyAmountSol) / trade.buyAmountSol) * 100 : (trade.pnlPct || 0);`;

content = content.replace(regex, replacement);

fs.writeFileSync('src/components/pages/PnLPage.tsx', content);
console.log('PnLPage.tsx patched to recalculate pnl on the fly');
