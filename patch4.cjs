const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/pumpSwapStopLoss, unknownStopLoss,/g, 'pumpSwapStopLoss, pumpSwapTakeProfit, unknownStopLoss,');
content = content.replace(/pumpSwapStopLoss, pumpSwapTakeProfit, unknownStopLoss, pumpSwapTakeProfit,/g, 'pumpSwapStopLoss, pumpSwapTakeProfit, unknownStopLoss,');

fs.writeFileSync('src/App.tsx', content);
console.log('App.tsx patched for latestState');
