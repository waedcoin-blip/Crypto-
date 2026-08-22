const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/pumpSwapStopLoss, setPumpSwapStopLoss,/g, 'pumpSwapStopLoss, setPumpSwapStopLoss, pumpSwapTakeProfit, setPumpSwapTakeProfit,');

fs.writeFileSync('src/App.tsx', content);
console.log('App.tsx patched PnLPage props');
