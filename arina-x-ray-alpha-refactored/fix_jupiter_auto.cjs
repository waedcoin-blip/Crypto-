const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// The original condition is: return ageMs <= 3000 && (m.percentageIncrease || 0) > 40;
// We will replace it with: return (m.percentageIncrease || 0) >= 50 && m.isRugSafe !== false;

content = content.replace(/if \(alphaProtocol === 'JUPITER_AUTO'\) \{\s*const ageMs = Date.now\(\) - \(m\.discoveredAt \|\| Date\.now\(\)\);\s*return ageMs <= 3000 && \(m\.percentageIncrease \|\| 0\) > 40;\s*\}/g, "if (alphaProtocol === 'JUPITER_AUTO') { return (m.percentageIncrease || 0) >= 50 && m.isRugSafe !== false; }");

content = content.replace(/const hasPotentialProfit = \(token\.percentageIncrease \|\| 0\) > 40;/g, "const hasPotentialProfit = (token.percentageIncrease || 0) >= 50;");
content = content.replace(/const isAgeValid = tokenAgeMs <= 3000;/g, "const isAgeValid = true; // Age restriction removed per requirements");
content = content.replace(/const isNotRug = token\.isRugSafe !== false;/g, "const isNotRug = token.isRugSafe !== false;");

fs.writeFileSync('src/App.tsx', content);
