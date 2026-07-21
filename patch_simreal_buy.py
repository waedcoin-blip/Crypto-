import re

with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

# First replacement (real swap success)
old_1 = """                  addLog(`✅ [SIMREAL REAL SWAP] Bought ${pos.symbol} @ ${boughtPriceSol.toFixed(8)} SOL | tx: ${result.txid.slice(0, 12)}...`, 'buy');"""
new_1 = """                  addLog(`✅ [SIMREAL REAL SWAP] Bought ${pos.symbol} @ ${boughtPriceSol.toFixed(8)} SOL | tx: ${result.txid.slice(0, 12)}...`, 'buy');
                  // Transfer to SimReal: Sell main position
                  executeSell(mint, newPrice, currentPnLPct / 100, 'TRANSFER TO SIMREAL');"""

# Second replacement (simulated swap success)
old_2 = """              if (isFallbackSim) {
                addLog(`⚠️ [SIMREAL FALLBACK BUY] Bought ${pos.symbol} for ${buyAmt.toFixed(4)} SOL via simulation (Fallback active: On-chain balance is 0.0000 SOL)`, 'info');
              } else {
                addLog(`[SIMREAL BUY] Bought ${pos.symbol} for ${buyAmt.toFixed(4)} SOL (Active position in profit >= 1%)`, 'info');
              }"""
new_2 = """              if (isFallbackSim) {
                addLog(`⚠️ [SIMREAL FALLBACK BUY] Bought ${pos.symbol} for ${buyAmt.toFixed(4)} SOL via simulation (Fallback active: On-chain balance is 0.0000 SOL)`, 'info');
              } else {
                addLog(`[SIMREAL BUY] Bought ${pos.symbol} for ${buyAmt.toFixed(4)} SOL (Active position in profit >= 1%)`, 'info');
              }
              // Transfer to SimReal: Sell main position
              executeSell(mint, newPrice, currentPnLPct / 100, 'TRANSFER TO SIMREAL');"""

content = content.replace(old_1, new_1)
content = content.replace(old_2, new_2)

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)
