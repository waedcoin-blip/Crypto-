const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

code = code.replace(
  "const intent = inputMint === SOL_MINT ? 'entry' : 'exit';",
  "const intent = inputMint === SOL_MINT ? 'entry' : 'exit_tp';"
);

fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log('Replaced successfully');
