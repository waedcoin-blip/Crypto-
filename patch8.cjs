const fs = require('fs');
let content = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const targetStr = `          addLog(\`Ordering \${pos.symbol} → SOL...\`, 'sell');
          const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell);
          if (result.txid) {
            const actualSolReceived = (result.outputAmount || 0) / 1e9;`;

const newStr = `          addLog(\`Ordering \${pos.symbol} → SOL...\`, 'sell');
          
          let preSol = 0;
          try {
             if (useActiveWalletStore.getState().activeWallet) {
                const conn = new Connection(rpcUrl, { commitment: 'confirmed' });
                preSol = await conn.getBalance(useActiveWalletStore.getState().activeWallet.keypair.publicKey) / 1e9;
             }
          } catch (e) {}
          
          const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell);
          if (result.txid) {
            let actualSolReceived = (result.outputAmount || 0) / 1e9;
            try {
               if (useActiveWalletStore.getState().activeWallet) {
                  const conn = new Connection(rpcUrl, { commitment: 'confirmed' });
                  const postSol = await conn.getBalance(useActiveWalletStore.getState().activeWallet.keypair.publicKey) / 1e9;
                  const delta = postSol - preSol;
                  if (delta > 0) actualSolReceived = delta;
               }
            } catch(e) {}
`;

content = content.replace(targetStr, newStr);

// Now remove the historical PnL sanitization logic
// "if (buySol > 0 && sellSol > buySol * 50 && pnl > 5000)"
const sanitizeRegex = /if \(buySol > 0 && sellSol > buySol \* 50 && pnl > 5000\) \{\s*pnl = Math\.min\(pnl, 100\);\s*sellSol = buySol \* \(1 \+ \(pnl \/ 100\)\);\s*\}/g;

content = content.replace(sanitizeRegex, '');

fs.writeFileSync('src/components/pages/PnLPage.tsx', content);
console.log('PnLPage.tsx patched for manual sell balance delta and sanitization removal');
