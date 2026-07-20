const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const targetStr = `    try {
      setPositions((prev) => {
        pos = prev[mint];
        if (!pos) return prev;
        
        if (!lamportsToSell || lamportsToSell <= 0) {
          addLog(\`No original token lamports for \${pos.symbol}, using fallback or removing position\`, 'warn');
          const newPos = { ...prev };
          delete newPos[mint];
          return newPos;
        }

        addLog(\`Ordering \${pos.symbol} → SOL...\`, 'sell');
        executeJupiterSwap(mint, SOL_MINT, lamportsToSell).then((result) => {`;

const replaceStr = `    try {
      if (!pos || !lamportsToSell || lamportsToSell <= 0) {
        addLog(\`No original token lamports for \${pos?.symbol || mint}, using fallback or removing position\`, 'warn');
        setPositions((prev) => {
          const newPos = { ...prev };
          delete newPos[mint];
          return newPos;
        });
        return;
      }

      addLog(\`Ordering \${pos.symbol} → SOL...\`, 'sell');
      executeJupiterSwap(mint, SOL_MINT, lamportsToSell).then((result) => {`;

code = code.replace(targetStr, replaceStr);

const targetStr2 = `        }).finally(() => {
          pendingSellMintsRef.current.delete(mint);
        });
        
        return prev;
      });
    } catch (e: any) {`;

const replaceStr2 = `        }).finally(() => {
          pendingSellMintsRef.current.delete(mint);
        });
    } catch (e: any) {`;

code = code.replace(targetStr2, replaceStr2);

fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log("Replaced successfully!");
