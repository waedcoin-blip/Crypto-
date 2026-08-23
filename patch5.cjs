const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const target = `  buySlot?: number;`;
const replacement = `  buySlot?: number;
  dexId?: string;
  bondingCurveProgress?: number;`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
  console.log('Replaced successfully');
} else {
  console.log('Target not found');
}
