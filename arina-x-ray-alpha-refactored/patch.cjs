const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf-8');

const targetFuncStart = `    const singleSwapInner = async (inMint: string, outMint: string, swapAmt: number) => {`;
const replaceFuncStart = `    const singleSwapInner = async (inMint: string, outMint: string, swapAmt: number, attempt = 1): Promise<any> => {`;

const targetExecute = `      const txid = await executeTxWithRPCFallback(transaction, connection);
      return { 
        txid, 
        outputAmount: parseFloat(quoteResponse.outAmount), 
        quoteOutAmountRaw: quoteResponse.outAmount, 
        estimatedPriceSol: parseFloat(quoteResponse.inAmount) / parseFloat(quoteResponse.outAmount) 
      };
    };`;

const replaceExecute = `      try {
        const txid = await executeTxWithRPCFallback(transaction, connection);
        return { 
          txid, 
          outputAmount: parseFloat(quoteResponse.outAmount), 
          quoteOutAmountRaw: quoteResponse.outAmount, 
          estimatedPriceSol: parseFloat(quoteResponse.inAmount) / parseFloat(quoteResponse.outAmount) 
        };
      } catch (execErr: any) {
        if (execErr.message?.includes('timed out waiting for confirmation') && attempt < 3) {
          useAppStore.getState().addJupiterLog({
            type: 'ERROR',
            message: \`Swap timeout detected. Retrying immediately (Attempt \${attempt + 1}/3)...\`,
          });
          return singleSwapInner(inMint, outMint, swapAmt, attempt + 1);
        }
        throw execErr;
      }
    };`;

code = code.replace(targetFuncStart, replaceFuncStart);
code = code.replace(targetExecute, replaceExecute);

fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log("Patched");
