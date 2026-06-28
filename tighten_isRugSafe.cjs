const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Update first isRugSafe definition
content = content.replace(
  '(security.devPct || 0) < 5 && \n                  (security.top10Pct || 0) < 30;',
  '(security.devPct || 0) <= 2 && \n                  (security.top10Pct || 0) <= 20;'
);

// Update second isRugSafe definition
content = content.replace(
  '(security.devPct || 0) < 3 && \n                     (security.top10Pct || 0) < 20',
  '(security.devPct || 0) <= 2 && \n                     (security.top10Pct || 0) <= 20'
);

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Update isRugSafe logic');
