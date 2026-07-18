const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf-8');

const targetSell = `        if (lamportsToSell > 0) {
          const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell);`;

const replaceSell = `        if (lamportsToSell > 0) {
          const simRealGross = currentPrice * (pos.simRealAmountTokens || 0);
          const simRealGrossPnLPercent = ((simRealGross - (pos.simRealSolSpent || 0.1)) / (pos.simRealSolSpent || 0.1)) * 100;
          let dynamicSlippage = slippage;
          if (simRealGrossPnLPercent > 0) dynamicSlippage = Math.max(0.3, Math.min(slippage, simRealGrossPnLPercent * 0.3));
          else dynamicSlippage = Math.min(slippage, 1.0);
          const slippageBps = Math.floor(dynamicSlippage * 100);
          const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell, slippageBps);`;

code = code.replace(targetSell, replaceSell);

const targetSimRealSell = `        if (lamportsToSell > 0) {
          const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell);`;

const replaceSimRealSell = `        if (lamportsToSell > 0) {
          const currentPrice = pos.currentPrice || pos.buyPrice || 0;
          const tokensQty = pos.simRealAmountTokens || 0;
          const simRealGross = currentPrice * tokensQty;
          const simRealGrossPnLPercent = ((simRealGross - (pos.simRealSolSpent || 0.1)) / (pos.simRealSolSpent || 0.1)) * 100;
          let dynamicSlippage = slippage;
          if (simRealGrossPnLPercent > 0) dynamicSlippage = Math.max(0.3, Math.min(slippage, simRealGrossPnLPercent * 0.3));
          else dynamicSlippage = Math.min(slippage, 1.0);
          const slippageBps = Math.floor(dynamicSlippage * 100);
          const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell, slippageBps);`;

code = code.replace(targetSimRealSell, replaceSimRealSell);

fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log("Patched 3");
