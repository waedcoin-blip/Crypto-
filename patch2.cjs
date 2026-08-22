const fs = require('fs');

// Patch App.tsx
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/const \[pumpSwapStopLoss, setPumpSwapStopLoss\] = useState\(\(\) => Number\(localStorage\.getItem\('app_pumpSwapStopLoss'\)\) \|\| -15\);/g, `const [pumpSwapStopLoss, setPumpSwapStopLoss] = useState(() => Number(localStorage.getItem('app_pumpSwapStopLoss')) || -15);
  const [pumpSwapTakeProfit, setPumpSwapTakeProfit] = useState(() => Number(localStorage.getItem('app_pumpSwapTakeProfit')) || 25);`);

content = content.replace(/localStorage\.setItem\('app_pumpSwapStopLoss', pumpSwapStopLoss\.toString\(\)\);/g, `localStorage.setItem('app_pumpSwapStopLoss', pumpSwapStopLoss.toString());
    localStorage.setItem('app_pumpSwapTakeProfit', pumpSwapTakeProfit.toString());`);

content = content.replace(/pumpSwapStopLoss, unknownStopLoss/g, 'pumpSwapStopLoss, pumpSwapTakeProfit, unknownStopLoss');

content = content.replace(/const userGlobalTP = typeof state\.minTakeProfit === 'number' \? state\.minTakeProfit : 25;/g, `const userGlobalTP = typeof state.minTakeProfit === 'number' ? state.minTakeProfit : 25;
          let baseTP = userGlobalTP;
          if (tradeDetails.recoveryMode) {
             baseTP = typeof state.bondingCurveTakeProfit === 'number' ? state.bondingCurveTakeProfit : userGlobalTP;
          } else if (tradeDetails.tokenMint?.toLowerCase().endsWith('pump')) {
             baseTP = typeof state.pumpSwapTakeProfit === 'number' ? state.pumpSwapTakeProfit : userGlobalTP;
          }
          const baseSL = ...`); 
          // wait, let's just use string replace on App.tsx for the exact block

fs.writeFileSync('src/App.tsx', content);
console.log('App.tsx basic patched');
