const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/if \(currentPage === 'gems-100x'\) {\s*\n\s*const isEarly = \([^)]+\) < 1800000;\s*\n\s*return isEarly && [^;]+;/g, "if (currentPage === 'gems-100x') { return true; }");

content = content.replace(/if \(currentPage === 'gems-100x'\) {\s*\n\s*const isEarly = \([^)]+\) < 1800000;\s*\/\/\s*Early[^;]+;/g, "if (currentPage === 'gems-100x') { return true; }");

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Fixed early pages');
