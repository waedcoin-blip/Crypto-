const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/const isMcValid = mc >= 5000 && mc <= 1000000;/g, "const isMcValid = mc >= 0;");
content = content.replace(/const isVolValid = vol > 0;/g, "const isVolValid = vol >= 0;");
content = content.replace(/const isLiqValid = liq >= 1000;/g, "const isLiqValid = liq >= 0;");
content = content.replace(/buySellRatio >= 1\.0/g, "buySellRatio >= 0");

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Fully relaxed');
