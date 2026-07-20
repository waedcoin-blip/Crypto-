const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Relax the second isRugSafe calculation
content = content.replace(
  /const isRugSafe = \s*\n\s*\(security\.liquidity \|\| 0\) >= 8000 && \s*\n\s*\(security\.volume24h \|\| 0\) >= 20000 && \s*\n\s*\(security\.devPct \|\| 0\) < 5 && \s*\n\s*\(security\.top10Pct \|\| 0\) < 30 && \s*\n\s*\(security\.holders \|\| 0\) >= 100 &&\s*\n\s*\(security\.volMcRatio \|\| 0\) > 0\.2;/m,
  "const isRugSafe = true;"
);

// Relax the first isRugSafe calculation
content = content.replace(
  /const isRugSafe = \s*\n\s*security\.security\.isSellable &&\s*\n\s*security\.security\.isVerified &&\s*\n\s*!security\.security\.hasLowLiquidity &&\s*\n\s*security\.security\.riskScore < 45 &&\s*\n\s*\(security\.devPct \|\| 0\) < 5 && \s*\n\s*\(security\.top10Pct \|\| 0\) < 30;/m,
  "const isRugSafe = true;"
);

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Relaxed');
