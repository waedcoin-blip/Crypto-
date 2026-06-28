const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Replace the UI filters
content = content.replace(/if \(alphaProtocol === 'JUPITER_AUTO'\) \{ return \(m\.percentageIncrease \|\| 0\) >= 50 && m\.isRugSafe !== false; \}/g, 
  "if (alphaProtocol === 'JUPITER_AUTO') { return (m.percentageIncrease || 0) >= 50 && m.isRugSafe !== false && (m.riskScore === undefined || m.riskScore < 50); }");

// Replace the execution logic
content = content.replace(/const isNotRug = token\.isRugSafe !== false;/g, 
  "const isNotRug = token.isRugSafe !== false && (token.riskScore === undefined || token.riskScore < 50);");

fs.writeFileSync('src/App.tsx', content);
