const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const target1 = `const tpValue = pos.tpPct ?? (isPump ? (configRef.current.bondingCurveTakeProfit || bondingCurveTakeProfit || 25) : (configRef.current.minTakeProfit || minTakeProfit || 25));
          const slValue = pos.slPct ?? (isPump ? (configRef.current.bondingCurveStopLossPct || bondingCurveStopLoss || 15) : (configRef.current.stopLossPct || stopLossPct || 15));`;

const repl1 = `const tpValue = isPump ? (configRef.current.bondingCurveTakeProfit || bondingCurveTakeProfit || 25) : (configRef.current.minTakeProfit || minTakeProfit || 25);
          
          let slValue = configRef.current.stopLossPct || stopLossPct || 15;
          if (stage.platform === 'PUMP_FUN' || stage.isBonding) slValue = configRef.current.bondingCurveStopLossPct || bondingCurveStopLoss || 15;
          else if (stage.platform === 'PUMPSWAP') slValue = configRef.current.pumpSwapStopLossPct || pumpSwapStopLoss || 15;
          else if (stage.platform === 'UNKNOWN' || stage.stage === 'UNKNOWN') slValue = configRef.current.unknownStopLossPct || unknownStopLoss || 15;`;

if (code.includes(target1)) {
  code = code.replace(target1, repl1);
  fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
  console.log('PnLPage.tsx updated successfully.');
} else {
  console.log('Target not found in PnLPage.tsx');
}
