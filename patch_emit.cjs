const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const target = `        const currentPnLPct = pnlFraction * 100;

        if (currentPnLPct >= 1.0 && !pos.simRealBought && !simRealBoughtPending.current.has(mint)) {`;

const replacement = `        const currentPnLPct = pnlFraction * 100;

        if (currentPnLPct >= 1.0 && !pos.simRealBought && !simRealBoughtPending.current.has(mint)) {
          emitBuySignal({
            tokenAddress: mint,
            symbol: pos.symbol,
            name: pos.symbol,
            entryPriceUsd: pos.buyPrice,
            triggerPriceUsd: newPrice,
            profitPercent: currentPnLPct,
          });`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
  console.log("Patched emitBuySignal");
} else {
  console.log("Target not found!");
}
