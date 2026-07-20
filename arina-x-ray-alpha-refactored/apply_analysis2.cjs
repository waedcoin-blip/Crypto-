const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const target = `                  // Criteria for Profit/Underperforming
                  const isProfit = gain >= 0;`;

const replacement = `                  // Improved Criteria for Profit/Underperforming (Factoring in slippage/fees & "Goldilocks" margin)
                  // Considering 2026 MEV & swap fees, a true profit margin should be >= 15% clear
                  const isProfit = gain >= 15 && isSafe; // Must be safe and clear 15% gain to be classified as a valid profit token`;

content = content.replace(target, replacement);

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Done');
