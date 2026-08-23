const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const t1 = `            tpPct: existing?.tpPct ?? ((detectTokenStage({ address: tokenAddress, dexId: tokenMetrics[tokenAddress]?.dexId, bondingCurveProgress: tokenMetrics[tokenAddress]?.bondingCurveProgress }).isBonding || tokenAddress.toLowerCase().endsWith('pump')) ? bondingCurveTakeProfit : minTakeProfit),
            slPct: existing?.slPct ?? ((detectTokenStage({ address: tokenAddress, dexId: tokenMetrics[tokenAddress]?.dexId, bondingCurveProgress: tokenMetrics[tokenAddress]?.bondingCurveProgress }).isBonding || tokenAddress.toLowerCase().endsWith('pump')) ? bondingCurveStopLoss : stopLoss)`;

if (code.includes(t1)) {
  code = code.replace(t1, '');
} else {
  console.log('t1 not found in App.tsx');
}

fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx TP part 3 updated successfully.');
