const fs = require('fs');

// --- 5. Fix PositionExitManager.ts ---
let pem = fs.readFileSync('src/services/PositionExitManager.ts', 'utf8');

// 1. Fix the TP routing
const monitorCreation = `const monitor = new PositionMonitor(
            mint,
            entryPrice,
            configRef.current.stopLoss || 10,
            configRef.current.minTakeProfit || 25,
            1.5
        );`;
        
const newMonitorCreation = `
        let targetTp = configRef.current.minTakeProfit || 25;
        let targetSl = configRef.current.stopLoss || 10;
        
        if (pos.source === 'pumpfun') {
            targetTp = configRef.current.bondingCurveTakeProfit || 25;
            targetSl = configRef.current.bondingCurveStopLoss || 10;
        } else if (pos.source === 'pumpswap') {
            targetTp = configRef.current.pumpSwapTakeProfit || 25;
            targetSl = configRef.current.pumpSwapStopLoss || 10;
        }
        
        const monitor = new PositionMonitor(
            mint,
            entryPrice,
            targetSl,
            targetTp,
            1.5
        );`;

pem = pem.replace(monitorCreation, newMonitorCreation);

// 2. Fix the PnL Calculation to use pre/post SOL delta
const executeBlock = `        const result = await useAppStore.getState().tradeManager.swap(
          mint,
          'So11111111111111111111111111111111111111112',
          lamportsToSell,
          configRef.current.slippage ? Math.floor(configRef.current.slippage * 100) : 1000,
          'exit'
        );

        if (result && result.signature) {
          const actualSolReceived = (result.outputAmount || 0) / 1e9;`;

const newExecuteBlock = `        const walletStore = (await import('../store/activeWalletStore')).useActiveWalletStore.getState();
        const Connection = (await import('@solana/web3.js')).Connection;
        
        let preSol = 0;
        try {
           if (walletStore.activeWallet) {
              const conn = new Connection(configRef.current.rpcUrl || 'https://api.mainnet-beta.solana.com');
              preSol = await conn.getBalance(walletStore.activeWallet.keypair.publicKey) / 1e9;
           }
        } catch(e) {}

        const result = await useAppStore.getState().tradeManager.swap(
          mint,
          'So11111111111111111111111111111111111111112',
          lamportsToSell,
          configRef.current.slippage ? Math.floor(configRef.current.slippage * 100) : 1000,
          'exit'
        );

        if (result && result.signature) {
          let actualSolReceived = (result.outputAmount || 0) / 1e9;
          
          try {
             if (walletStore.activeWallet) {
                const conn = new Connection(configRef.current.rpcUrl || 'https://api.mainnet-beta.solana.com');
                const postSol = await conn.getBalance(walletStore.activeWallet.keypair.publicKey) / 1e9;
                const delta = postSol - preSol;
                if (delta > 0) actualSolReceived = delta;
             }
          } catch(e) {}`;

if (pem.includes(executeBlock) && !pem.includes('const delta = postSol - preSol')) {
    pem = pem.replace(executeBlock, newExecuteBlock);
}

fs.writeFileSync('src/services/PositionExitManager.ts', pem);
console.log('✅ PositionExitManager.ts patched');
