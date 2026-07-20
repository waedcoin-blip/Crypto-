const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/if \(currentPage === 'gems-100x'\) {[^}]+}/g, "if (currentPage === 'gems-100x') { return true; }");

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Fixed early pages effectively');
