const fs = require('fs');
let content = fs.readFileSync('server/services/criteriaService.ts', 'utf8');
console.log("buyAmountSol", content.includes('buyAmountSol'));
console.log("tradeAmount", content.includes('tradeAmount'));
console.log("pumpSwapTakeProfit", content.includes('pumpSwapTakeProfit'));
