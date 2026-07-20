const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf-8');

const targetQuote = `        quoteResponse = JSON.parse(quoteText);
        useAppStore.getState().addJupiterLog({
          type: 'INFO',
          message: \`Direct Quote Success: \${quoteResponse.outAmount}\`,
          details: { outAmount: quoteResponse.outAmount }
        });`;

const replaceQuote = `        quoteResponse = JSON.parse(quoteText);
        useAppStore.getState().addJupiterLog({
          type: 'INFO',
          message: \`Direct Quote Success: \${quoteResponse.outAmount}\`,
          details: { outAmount: quoteResponse.outAmount }
        });
        
        if (minExpectedOutSol !== undefined && outMint === SOL_MINT) {
           const guaranteedSol = Number(quoteResponse.otherAmountThreshold) / 1_000_000_000;
           if (guaranteedSol < minExpectedOutSol) {
             throw new Error(\`PROFIT GUARD: Jupiter guaranteed out (\${guaranteedSol.toFixed(4)} SOL) is lower than the required minimum (\${minExpectedOutSol.toFixed(4)} SOL). Swap aborted.\`);
           }
        }`;

code = code.replace(targetQuote, replaceQuote);

fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log("Patched 6");
