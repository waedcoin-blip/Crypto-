const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const startStr = "const trackingVerdict = await processActiveTrackingFrame(";
const endStr = "fns.current.executeAutoSell(tokenAddress, token.symbol, trackingVerdict.quote);\n          }";

const startIdx = code.indexOf(startStr);
const endIdx = code.indexOf(endStr) + endStr.length;

if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
  const replacement = `const trackingVerdict = { shouldExit: false, reason: '' };
          if (currentPnLPct >= activeTakeProfit) {
            trackingVerdict.shouldExit = true;
            trackingVerdict.reason = 'TAKE PROFIT';
          } else if (currentPnLPct <= effectiveSL) {
            trackingVerdict.shouldExit = true;
            trackingVerdict.reason = effectiveSL !== baseSL ? 'TRAILING SL' : 'STOP LOSS';
          } else if (position.isManualSellTriggered) {
            trackingVerdict.shouldExit = true;
            trackingVerdict.reason = 'MANUAL';
          }

          if (trackingVerdict.shouldExit) {
            console.log(\`[EXIT BY ENGINE] (LIVE): \${token.symbol} clearing. Reason: \${trackingVerdict.reason}\`);
            fns.current.executeAutoSell(tokenAddress, token.symbol);
          }`;
  code = code.substring(0, startIdx) + replacement + code.substring(endIdx);
  fs.writeFileSync('src/App.tsx', code);
  console.log('Replaced successfully by index');
} else {
  console.log('Target not found by index');
}
