const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/const isMcValid = mc >= 50000 && mc <= 100000;/g, "const isMcValid = mc >= 10000 && mc <= 500000;");
content = content.replace(/const isVolValid = mc > 0 && \(vol \/ mc >= 2\);/g, "const isVolValid = mc > 0 && (vol / mc >= 1.0);");
content = content.replace(/const isLiqValid = liq >= 15000;/g, "const isLiqValid = liq >= 5000;");
content = content.replace(/buySellRatio >= 2\.0/g, "buySellRatio >= 1.5");
content = content.replace(/const hasHolders = \(m\.holderCount \|\| 0\) > 400;/g, "const hasHolders = (m.holderCount || 0) > 100;");
content = content.replace(/const safeDev = \(m\.devWalletPercentage \|\| 0\) <= 2;/g, "const safeDev = (m.devWalletPercentage || 0) <= 5;");
content = content.replace(/const hasVelocity = buy30sVol >= 5000;/g, "const hasVelocity = buy30sVol >= 1000;");

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Relaxed');
