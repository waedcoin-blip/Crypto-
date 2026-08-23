const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/entryPriceSol: newEntryPriceSol,\n,/g, 'entryPriceSol: newEntryPriceSol,');
fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx comma fixed.');
