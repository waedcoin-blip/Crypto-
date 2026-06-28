const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const target = "if (alphaProtocol === 'HIGH_PROFIT') return (m.percentageIncrease || 0) >= 60;";
const replacement = "if (alphaProtocol === 'HIGH_PROFIT') return (m.percentageIncrease || 0) >= 60 && m.isRugSafe && ((m.volume24h || 0) / (m.marketCap || 1)) >= 1.0;";

content = content.split(target).join(replacement);

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Done');
