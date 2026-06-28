const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Relax isRugSafe
content = content.replace(
  '(security.devPct || 0) <= 2 && \n                  (security.top10Pct || 0) <= 20;',
  '(security.devPct || 0) < 5 && \n                  (security.top10Pct || 0) < 30;'
);

content = content.replace(
  '(security.devPct || 0) <= 2 && \n                     (security.top10Pct || 0) <= 20',
  '(security.devPct || 0) < 5 && \n                     (security.top10Pct || 0) < 30'
);

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Relaxed');
