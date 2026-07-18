const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf-8');

const target1 = `          // Independent SimReal Auto-Sell Check (ensure to sell and transfer to wallet in +pnl after detecting slippage)
          if (pos.simRealBought && pos.simRealSolSpent && !safeToExecute) {
            const simRealGross = currentPrice * (pos.simRealAmountTokens || 0);
            let simRealNetSolReturn = simRealGross;
            let simRealNetPnlPct = 0;
            
            if (typeof quote !== 'undefined' && quote && pos.amountLamports && pos.amount) {
               const guaranteedMinLamports = BigInt(quote.otherAmountThreshold);
               const guaranteedSolOut = Number(guaranteedMinLamports) / 1_000_000_000.0;
               const ratio = (pos.simRealAmountTokens || 0) / pos.amount;
               const scaledSolOut = guaranteedSolOut * ratio;
               const operationalFeesSol = getDynamicOperationalFeeSol(pos.recoveryMode, pos.simRealSolSpent); 
               simRealNetSolReturn = Math.max(0, scaledSolOut - operationalFeesSol);
            } else {
               const simRealGrossPnLPercent = ((simRealGross - pos.simRealSolSpent) / pos.simRealSolSpent) * 100;
               let dynamicSlippage = slippage;
               if (simRealGrossPnLPercent > 0) dynamicSlippage = Math.max(0.3, Math.min(slippage, simRealGrossPnLPercent * 0.3));
               else dynamicSlippage = Math.min(slippage, 1.0);
               const slippageFeeCalc = simRealGross * (dynamicSlippage / 100);
               const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, pos.simRealSolSpent || 0.1);
               simRealNetSolReturn = Math.max(0, simRealGross - slippageFeeCalc - opFees);
            }
            simRealNetPnlPct = (simRealNetSolReturn - pos.simRealSolSpent) / pos.simRealSolSpent;
            
            if (simRealNetPnlPct > 0) {
               executeReason = \`SIMREAL SECURE PROFIT: \${pos.symbol} +\${(simRealNetPnlPct * 100).toFixed(2)}% (NET)\`;
               safeToExecute = true;
            }
          }`;

// Replace all instances of target1 with something that defines `quote` as `any` locally if it doesn't exist, 
// wait, I can just use a block scope `{ let _quote: any = typeof quote !== 'undefined' ? quote : undefined; ... }`
// But TS will still complain about `typeof quote`.
// The easiest is just replace it entirely with a version without quote in the Live block.

code = code.replace(
  `          // Live/Fallback Logic`,
  `          // Live/Fallback Logic\n          const quote: any = undefined;`
);

fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log("Patched 9");
