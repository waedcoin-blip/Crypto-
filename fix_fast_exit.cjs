const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const target = `        slippageBpsSl: Math.floor((configRef.current.slippage || 10.0) * 100),`;
const replacement = `        slippageBpsSl: 1000,`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
  console.log('Replaced slippageBpsSl successfully');
} else {
  console.log('Target not found for slippageBpsSl');
}
