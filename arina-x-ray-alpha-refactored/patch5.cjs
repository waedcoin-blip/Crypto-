const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf-8');

code = code.replace(
  `const isStopLossSignal = executeReason?.toLowerCase().includes('stop loss') || executeReason?.toLowerCase().includes('emergency') || executeReason?.toLowerCase().includes('force');`,
  `const isStopLossSignal = typeof reason !== 'undefined' ? (reason?.toLowerCase().includes('stop loss') || reason?.toLowerCase().includes('emergency') || reason?.toLowerCase().includes('force')) : false;`
);

// For the second one inside executeSimRealSell
code = code.replace(
  `const isStopLossSignal = executeReason?.toLowerCase().includes('stop loss') || executeReason?.toLowerCase().includes('emergency') || executeReason?.toLowerCase().includes('force');`,
  `const isStopLossSignal = true; // Emergency force exit`
);

fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log("Patched 5");
