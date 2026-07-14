const fs = require('fs');
let code = fs.readFileSync('vite.config.ts', 'utf-8');

const target = `    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
               if (id.includes('@solana')) return 'solana';
               if (id.includes('react')) return 'react';
               return 'vendor';
            }
          }
        }
      }
    }`;
const replacement = `    build: {
      chunkSizeWarningLimit: 2500,
    }`;

if (code.includes('chunkSizeWarningLimit: 1500,')) {
   const updated = code.replace(target, replacement);
   fs.writeFileSync('vite.config.ts', updated);
   console.log('patched');
}
