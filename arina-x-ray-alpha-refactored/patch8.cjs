const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf-8');

const targetCatch = `      } catch (err: any) {
        addLog(\`❌ [SIMREAL REAL SWAP FAILED] Real sell swap failed: \${err.message}. Performing simulated emergency exit fallback.\`, 'err');
      }`;

const replaceCatch = `      } catch (err: any) {
        if (err.message.includes('PROFIT GUARD')) {
           addLog(\`❌ [SIMREAL REAL SWAP ABORTED] \${err.message} Keeping position open.\`, 'warn');
           return; // Abort the simulated sell too
        }
        addLog(\`❌ [SIMREAL REAL SWAP FAILED] Real sell swap failed: \${err.message}. Performing simulated emergency exit fallback.\`, 'err');
      }`;

code = code.replace(targetCatch, replaceCatch);

fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log("Patched 8");
