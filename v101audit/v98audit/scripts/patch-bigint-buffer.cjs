const fs = require('fs');
const path = require('path');

try {
  const targetPath = path.join(__dirname, '..', 'node_modules', 'bigint-buffer', 'dist', 'node.js');
  const browserPath = path.join(__dirname, '..', 'node_modules', 'bigint-buffer', 'dist', 'browser.js');

  if (fs.existsSync(targetPath) && fs.existsSync(browserPath)) {
    const browserCode = fs.readFileSync(browserPath, 'utf8');
    fs.writeFileSync(targetPath, browserCode, 'utf8');
    console.log('[patch-bigint-buffer] Successfully patched bigint-buffer node.js with clean pure-JS implementation.');
  }
} catch (err) {
  console.warn('[patch-bigint-buffer] Could not patch bigint-buffer:', err.message);
}
