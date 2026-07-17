const fs = require('fs');
const file = 'src/components/pages/SimRealPage.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  'Jupiter API Key (Custom Proxy URL)',
  'Jupiter API Key'
);

code = code.replace(
  'Optional. Direct custom Jupiter API endpoint URL',
  'Optional. Jupiter premium API key'
);

fs.writeFileSync(file, code);
