const fs = require('fs');
let content = fs.readFileSync('src/services/PositionExitManager.ts', 'utf8');

const targetStr = `      const result = await this.executor.swap(
        mint,
        'So11111111111111111111111111111111111111112',
        pos.amount,
        slippageBps,
        label
      );`;

const newStr = `      const preSolBalance = await this.executor.getSolBalance().catch(() => 0);
      const result = await this.executor.swap(
        mint,
        'So11111111111111111111111111111111111111112',
        pos.amount,
        slippageBps,
        label
      );
      
      // Calculate actual SOL received based on balance delta (authoritative)
      const postSolBalance = await this.executor.getSolBalance().catch(() => 0);
      let actualSolReceived = (postSolBalance > 0 && preSolBalance > 0) 
        ? (postSolBalance - preSolBalance) 
        : ((result.outputAmount / 1e9) - result.feeSol);
        
      // Ensure we don't accidentally report negative received unless fees were truly > output
      // Though technically possible, we'll trust the balance delta if both are valid
      if (preSolBalance === 0 || postSolBalance === 0 || (actualSolReceived <= 0 && result.outputAmount > 0)) {
         actualSolReceived = (result.outputAmount / 1e9) - result.feeSol;
      }`;

content = content.replace(targetStr, newStr);

content = content.replace(/this\.onExitCallback\(mint, side, result\.signature \|\| 'exit-tx', pnlPct, \(result\.outputAmount \/ 1e9\) - result\.feeSol\);/g, 
"this.onExitCallback(mint, side, result.signature || 'exit-tx', pnlPct, actualSolReceived);");

fs.writeFileSync('src/services/PositionExitManager.ts', content);
console.log('PositionExitManager.ts patched');
