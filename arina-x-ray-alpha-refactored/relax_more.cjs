const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/const hasVelocity = buy30sVol >= 1000;/g, "const hasVelocity = true;");
content = content.replace(/buySellRatio >= 1\.5/g, "buySellRatio >= 1.0");
content = content.replace(/const hasHolders = \(m\.holderCount \|\| 0\) > 100;\s*\/\/\s*stricter holders/g, "const hasHolders = (m.holderCount || 0) >= 0;");
content = content.replace(/const safeDev = \(m\.devWalletPercentage \|\| 0\) <= 5;\s*\/\/\s*Strict dev limits/g, "const safeDev = true;");
content = content.replace(/const isMcValid = mc >= 10000 && mc <= 500000;/g, "const isMcValid = mc >= 5000 && mc <= 1000000;");
content = content.replace(/const isVolValid = mc > 0 && \(vol \/ mc >= 1\.0\);/g, "const isVolValid = vol > 0;");
content = content.replace(/const isLiqValid = liq >= 5000;\s*\/\/\s*Stronger liquidity floor/g, "const isLiqValid = liq >= 1000;");

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Done');
