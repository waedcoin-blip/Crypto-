const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Replace the EXIT STRATEGY segment
const targetBlock = `          if (currentPnL >= state.profitTarget || currentPnL <= state.stopLoss) {
            const reason = currentPnL >= state.profitTarget ? "Take Profit" : "Stop Loss";
            console.log(\`[EXIT] \${reason} for \${token.symbol}: \${currentPnL.toFixed(2)}% (Real)\`);
            fns.current.executeAutoSell(token.address, token.symbol);
          }`;

const replacementBlock = `          if (state.moonbagStrategy) {
            if (currentPnL >= 900 && !position.hasPulled10x) {
              console.log(\`[EXIT] Pulling 50% at 10x for \${token.symbol}\`);
              fns.current.executePartialSell(token.address, token.symbol, 0.5, 'hasPulled10x');
            } else if (currentPnL >= 100 && !position.hasPulledPrincipal) {
              console.log(\`[EXIT] Pulling Principal at 2x for \${token.symbol}\`);
              // Pulling principal means selling 50% if currently at 2x
              fns.current.executePartialSell(token.address, token.symbol, 0.5, 'hasPulledPrincipal');
            } else if (currentPnL <= state.stopLoss) {
              console.log(\`[EXIT] Stop Loss for \${token.symbol}\`);
              fns.current.executeAutoSell(token.address, token.symbol);
            }
          } else {
            if (currentPnL >= state.profitTarget || currentPnL <= state.stopLoss) {
              const reason = currentPnL >= state.profitTarget ? "Take Profit" : "Stop Loss";
              console.log(\`[EXIT] \${reason} for \${token.symbol}: \${currentPnL.toFixed(2)}% (Real)\`);
              fns.current.executeAutoSell(token.address, token.symbol);
            }
          }`;

content = content.replace(targetBlock, replacementBlock);
fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log("Exit strategy updated");
