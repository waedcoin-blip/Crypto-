const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/const isLiqValid = liq >= 10000 && liq <= 30000;/g, "const isLiqValid = liq >= 15000;");
content = content.replace(/const hasHolders = \(m\.holderCount \|\| 0\) > 300;/g, "const hasHolders = (m.holderCount || 0) > 400;");
content = content.replace(/const safeDev = \(m\.devWalletPercentage \|\| 0\) < 5;/g, "const safeDev = (m.devWalletPercentage || 0) <= 2;");
content = content.replace(/buySellRatio >= 1\.5/g, "buySellRatio >= 2.0");

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Update first instance');
