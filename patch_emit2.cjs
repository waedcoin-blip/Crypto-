const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const target = `        if (currentPnLPct >= 1.0 && !pos.simRealBought && !simRealBoughtPending.current.has(mint)) {
          emitBuySignal({
            tokenAddress: mint,
            symbol: pos.symbol,
            name: pos.symbol,
            entryPriceUsd: pos.buyPrice,
            triggerPriceUsd: newPrice,
            profitPercent: currentPnLPct,
          });`;

const replacement = `        if (currentPnLPct >= 1.0 && !pos.simRealBought && !simRealBoughtPending.current.has(mint)) {
          const simPos = simPositions[mint];
          if (!simPos) continue; // Must be tracked in simPositions to emit a full signal
          emitBuySignal({
            tokenAddress: mint,
            symbol: pos.symbol,
            name: pos.symbol, // or simPos.name
            entryPriceUsd: pos.buyPrice,
            triggerPriceUsd: newPrice,
            profitPercent: currentPnLPct,
            liquidityUsd: simPos.liquidityUsd,
            volume24h: simPos.volume24h,
            dexId: simPos.dexId,
            pairAddress: simPos.pairAddress,
            simAmountSol: simPos.amountSol,
            simEntryTime: simPos.entryTime
          });`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
  console.log("Patched emitBuySignal 2");
} else {
  console.log("Target not found!");
}
