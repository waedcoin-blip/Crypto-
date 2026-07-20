const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/if \(currentPage === 'gems-100x'\) \{\s*const isEarly.*?\s*return isEarly.*?\}/gs, "if (currentPage === 'gems-100x') { return true; }");

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Fixed early pages effectively 2');
