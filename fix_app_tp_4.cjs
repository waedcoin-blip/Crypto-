const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const t2 = `            tpPct: existing?.tpPct ?? ((detectTokenStage({ address: tokenAddress, dexId: tokenMetrics[tokenAddress]?.dexId, bondingCurveProgress: tokenMetrics[tokenAddress]?.bondingCurveProgress }).isBonding || tokenAddress.toLowerCase().endsWith('pump')) ? bondingCurveTakeProfit : minTakeProfit),
            slPct: existing?.slPct ?? ((detectTokenStage({ address: tokenAddress, dexId: tokenMetrics[tokenAddress]?.dexId, bondingCurveProgress: tokenMetrics[tokenAddress]?.bondingCurveProgress }).isBonding || tokenAddress.toLowerCase().endsWith('pump')) ? bondingCurveStopLoss : stopLoss)`;

if (code.includes(t2)) {
  code = code.replace(t2, '');
} else {
  console.log('t2 not found in App.tsx');
}

fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx TP part 4 updated successfully.');
