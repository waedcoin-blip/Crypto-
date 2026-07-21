import re

# --- 1. Patch SimRealPage.tsx ---
with open('src/components/pages/SimRealPage.tsx', 'r') as f:
    simreal = f.read()

# Replace monitorPositions in SimRealPage.tsx
old_monitor = """     for (const pos of activeSimrealPositions) {
         if (!pos || !pos.simRealBought) continue;
         
         const mint = Object.keys(positions).find(k => positions[k] === pos);
         if (!mint) continue;
         
         const tokenMetric = tokenMetrics[mint];
         const stageInfo = tokenMetric ? detectTokenStage(tokenMetric) : { stage: 'UNKNOWN', platform: 'UNKNOWN', isBonding: false, isMigrated: false, isNewListing: false, isNearMigration: false, bondingProgress: 0 } as const;
         
         let tpLimit = 0.50; // default 50%
         let slLimit = -0.15; // default -15%
         
         if (stageInfo.platform === 'RAYDIUM' || stageInfo.isMigrated) {
             tpLimit = (simRealTakeProfitRaydium !== undefined ? simRealTakeProfitRaydium : 50) / 100;
             slLimit = (simRealStopLossRaydium !== undefined ? simRealStopLossRaydium : -15) / 100;
         } else if (stageInfo.platform === 'PUMP_FUN' && stageInfo.stage === 'BONDING') {
             tpLimit = (simRealTakeProfitBonding !== undefined ? simRealTakeProfitBonding : 100) / 100;
             slLimit = (simRealStopLossBonding !== undefined ? simRealStopLossBonding : -20) / 100;
         } else if (stageInfo.platform === 'PUMPSWAP') {
             tpLimit = (simRealTakeProfitRaydium !== undefined ? simRealTakeProfitRaydium : 50) / 100; // No specific PumpSwap TP provided by user, reusing Raydium or Bonding? Wait, we can reuse bonding since it's pre-raydium
             slLimit = (simRealStopLossPumpSwap !== undefined ? simRealStopLossPumpSwap : -15) / 100;
         } else {
             tpLimit = (simRealTakeProfitRaydium !== undefined ? simRealTakeProfitRaydium : 50) / 100;
             slLimit = (simRealStopLossUnknown !== undefined ? simRealStopLossUnknown : -20) / 100;
         }

         const currentPrice = pos.currentPrice || pos.buyPrice || 0;
         const tokensQty = pos.simRealAmountTokens || 0;
         const spentSol = pos.simRealSolSpent || 0.1;

         const currentGrossSimReal = currentPrice * tokensQty;
         let netSimRealIfSold = currentGrossSimReal;

         if (!privateKey) {
            const slippageFee = currentGrossSimReal * (slippage / 100);
            const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol);
            netSimRealIfSold = Math.max(0, currentGrossSimReal - slippageFee - opFees);
         }

         const simRealNetPnlPct = (netSimRealIfSold - spentSol) / spentSol;"""

new_monitor = """     for (const [mint, pos] of Object.entries(positions)) {
         if (!pos || !pos.simRealBought) continue;
         
         const tokenMetric = tokenMetrics[mint];
         const stageInfo = tokenMetric ? detectTokenStage(tokenMetric) : { stage: 'UNKNOWN', platform: 'UNKNOWN', isBonding: false, isMigrated: false, isNewListing: false, isNearMigration: false, bondingProgress: 0 } as const;
         
         let tpLimit = 0.50; // default 50%
         let slLimit = -0.15; // default -15%
         
         if (stageInfo.platform === 'RAYDIUM' || stageInfo.isMigrated) {
             tpLimit = (simRealTakeProfitRaydium !== undefined ? simRealTakeProfitRaydium : 50) / 100;
             slLimit = (simRealStopLossRaydium !== undefined ? simRealStopLossRaydium : -15) / 100;
         } else if (stageInfo.platform === 'PUMP_FUN' && stageInfo.stage === 'BONDING') {
             tpLimit = (simRealTakeProfitBonding !== undefined ? simRealTakeProfitBonding : 100) / 100;
             slLimit = (simRealStopLossBonding !== undefined ? simRealStopLossBonding : -20) / 100;
         } else if (stageInfo.platform === 'PUMPSWAP') {
             tpLimit = (simRealTakeProfitRaydium !== undefined ? simRealTakeProfitRaydium : 50) / 100;
             slLimit = (simRealStopLossPumpSwap !== undefined ? simRealStopLossPumpSwap : -15) / 100;
         } else {
             tpLimit = (simRealTakeProfitRaydium !== undefined ? simRealTakeProfitRaydium : 50) / 100;
             slLimit = (simRealStopLossUnknown !== undefined ? simRealStopLossUnknown : -20) / 100;
         }

         const spentSol = pos.simRealSolSpent || pos.solSpent || 0.1;
         const boughtPrice = pos.simRealBoughtPriceSol || pos.buyPrice || pos.currentPrice || 0.000001;
         const currPrice = pos.currentPrice || pos.buyPrice || boughtPrice;
         const tokensQty = (pos.simRealAmountTokens && pos.simRealAmountTokens > 0)
           ? pos.simRealAmountTokens
           : (pos.amount && pos.amount > 0)
           ? pos.amount
           : (spentSol / boughtPrice);

         const currentGrossSimReal = currPrice * tokensQty;
         let netSimRealIfSold = currentGrossSimReal;

         if (!privateKey) {
            const slippageFee = currentGrossSimReal * (slippage / 100);
            const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol);
            netSimRealIfSold = Math.max(0, currentGrossSimReal - slippageFee - opFees);
         }

         const simRealNetPnlPct = (netSimRealIfSold - spentSol) / spentSol;"""

if old_monitor in simreal:
    simreal = simreal.replace(old_monitor, new_monitor)
    with open('src/components/pages/SimRealPage.tsx', 'w') as f:
        f.write(simreal)
    print("SimRealPage.tsx monitorPositions patched")
else:
    print("WARNING: old_monitor not found in SimRealPage.tsx")

