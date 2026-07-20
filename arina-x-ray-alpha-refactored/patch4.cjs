const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf-8');

const oldSignature = `const executeJupiterSwap = async (inputMint: string, outputMint: string, amount: number, customSlippageBps?: number) => {`;
const newSignature = `const executeJupiterSwap = async (inputMint: string, outputMint: string, amount: number, customSlippageBps?: number, minExpectedOutSol?: number) => {`;

code = code.replace(oldSignature, newSignature);

const targetQuote = `        quoteResponse = JSON.parse(quoteText);
        useAppStore.getState().addJupiterLog({
          type: 'INFO',
          message: \`Quote received for direct route: \${quoteResponse.outAmount} out\`
        });`;

const replaceQuote = `        quoteResponse = JSON.parse(quoteText);
        useAppStore.getState().addJupiterLog({
          type: 'INFO',
          message: \`Quote received for direct route: \${quoteResponse.outAmount} out\`
        });
        
        if (minExpectedOutSol !== undefined && outMint === SOL_MINT) {
           const guaranteedSol = Number(quoteResponse.otherAmountThreshold) / 1_000_000_000;
           if (guaranteedSol < minExpectedOutSol) {
             throw new Error(\`PROFIT GUARD: Jupiter guaranteed out (\${guaranteedSol.toFixed(4)} SOL) is lower than the required minimum (\${minExpectedOutSol.toFixed(4)} SOL). Swap aborted.\`);
           }
        }`;

code = code.replace(targetQuote, replaceQuote);

const targetSellParams = `const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell, slippageBps);`;
// We need to replace all instances of this inside the two places we modified.
// Wait, we need to pass the minExpectedSol, which is the amount of SOL we spent + operational fees.
// The amount we spent is `pos.simRealSolSpent`.

const replaceSellParams = `
          const opFeesSol = getDynamicOperationalFeeSol(pos.recoveryMode, pos.simRealSolSpent || 0.1);
          // If it's a stop loss or emergency, we don't enforce profit guard! We only enforce if we expect it to be a +pnl sell.
          const isStopLossSignal = executeReason?.toLowerCase().includes('stop loss') || executeReason?.toLowerCase().includes('emergency') || executeReason?.toLowerCase().includes('force');
          const minExpectedOut = isStopLossSignal ? undefined : ((pos.simRealSolSpent || 0) + opFeesSol);
          
          const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell, slippageBps, minExpectedOut);`;

code = code.replaceAll(targetSellParams, replaceSellParams);

fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log("Patched 4");
