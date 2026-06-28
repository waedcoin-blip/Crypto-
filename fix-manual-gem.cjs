const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(
  'if (security && security.security && security.security.symbol) {',
  'if (security && security.symbol) {'
);

content = content.replace(
  'const symbol = security.security.symbol;',
  'const symbol = security.symbol;'
);

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log("Fixed manual adding condition");
