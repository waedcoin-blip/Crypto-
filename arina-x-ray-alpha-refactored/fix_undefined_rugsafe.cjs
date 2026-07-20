const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/m\.isRugSafe && hasVelocity;/g, "m.isRugSafe !== false && hasVelocity;");

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Fixed');
