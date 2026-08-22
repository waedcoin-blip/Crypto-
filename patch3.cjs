const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /let activeTakeProfit = position\.tpPct \?\? \(stage\.isBonding\s*\?\s*\(typeof state\.bondingCurveTakeProfit === 'number' \? state\.bondingCurveTakeProfit : 25\)\s*: \(state\.moonbagStrategy \? \(position\.soldPartial \? state\.maxTakeProfit : state\.minTakeProfit\) : state\.minTakeProfit\)\);/g;

const replacement = `let activeTakeProfit = position.tpPct;
          if (activeTakeProfit === undefined) {
             if (stage.isBonding) {
                 activeTakeProfit = typeof state.bondingCurveTakeProfit === 'number' ? state.bondingCurveTakeProfit : 25;
             } else if (stage.platform === 'PUMPSWAP') {
                 activeTakeProfit = typeof state.pumpSwapTakeProfit === 'number' ? state.pumpSwapTakeProfit : 25;
             } else {
                 activeTakeProfit = state.moonbagStrategy ? (position.soldPartial ? state.maxTakeProfit : state.minTakeProfit) : state.minTakeProfit;
             }
          }`;

content = content.replace(regex, replacement);

fs.writeFileSync('src/App.tsx', content);
console.log('App.tsx activeTakeProfit patched');
