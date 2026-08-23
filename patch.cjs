const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `          const trackingVerdict = await processActiveTrackingFrame(
            connection,
            actPos,
            token.liquidity || 0,
            walletAddress,
            { 
               takeProfit: activeTakeProfit,
               stopLoss: effectiveSL
            }
          );
          if (trackingVerdict.shouldExit) {
            const slType = effectiveSL !== baseSL ? 'TRAILING SL' : trackingVerdict.reason;
            console.log(\`[EXIT BY ENGINE] (LIVE): \${token.symbol} clearing. Reason: \${slType}\`);
            fns.current.executeAutoSell(tokenAddress, token.symbol, trackingVerdict.quote);
          }`;

const replacement = `          const trackingVerdict = { shouldExit: false, reason: '' };
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

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/App.tsx', code);
  console.log('Replaced successfully');
} else {
  console.log('Target not found');
}
