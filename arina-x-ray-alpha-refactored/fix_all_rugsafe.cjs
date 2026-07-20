const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/m\.isRugSafe &&/g, "m.isRugSafe !== false &&");

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Fixed undefined boolean checks on isRugSafe');
