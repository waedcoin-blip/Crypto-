const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const target = `const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell);`;
const replacement = `const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell, reason === 'EMERGENCY FORCE EXIT' ? 1000 : undefined);`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
  console.log('Replaced force exit slippage successfully');
} else {
  console.log('Target not found for force exit slippage');
}
