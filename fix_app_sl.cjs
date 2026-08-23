const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetSL = `baseSL = position.slPct !== undefined ? position.slPct : baseSL;
          baseSL = -Math.abs(baseSL);`;

const replSL = `baseSL = -Math.abs(baseSL);`;

if (code.includes(targetSL)) {
  code = code.replace(targetSL, replSL);
}

const targetTP = `let activeTakeProfit = position.tpPct ?? (stage.isBonding 
            ? (typeof state.bondingCurveTakeProfit === 'number' ? state.bondingCurveTakeProfit : 25) 
            : (state.moonbagStrategy ? (position.soldPartial ? state.maxTakeProfit : state.minTakeProfit) : state.minTakeProfit));`;

const replTP = `let activeTakeProfit = stage.isBonding 
            ? (typeof state.bondingCurveTakeProfit === 'number' ? state.bondingCurveTakeProfit : 25) 
            : (state.moonbagStrategy ? (position.soldPartial ? state.maxTakeProfit : state.minTakeProfit) : state.minTakeProfit);`;

if (code.includes(targetTP)) {
  code = code.replace(targetTP, replTP);
}

fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx SL/TP updated successfully.');
