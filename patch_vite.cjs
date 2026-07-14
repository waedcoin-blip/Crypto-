const fs = require('fs');
let code = fs.readFileSync('vite.config.ts', 'utf-8');

const target = `    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },`;
const replacement = `    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
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
if (code.includes('server: {')) {
   const updated = code.replace(/server:\s*{[^}]*hmr:[^}]*},/, replacement);
   fs.writeFileSync('vite.config.ts', updated);
   console.log('patched');
}
