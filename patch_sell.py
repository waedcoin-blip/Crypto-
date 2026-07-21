import re

with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

old_block = """    let isMainSold = false;
    let isSimRealSold = false;
    let simRealRealSwapOutputSol: number | undefined = undefined;

    // Real sell for Simreal active positions if privateKey is active"""

new_block = """    let isMainSold = false;
    let isSimRealSold = false;
    let simRealRealSwapOutputSol: number | undefined = undefined;

    if (isTransferToSimReal) {
      addLog(`[TRANSFER] Moving ${pos.symbol} entirely to SimReal. Closing simulation tracking without API quote.`, 'info');
      // Just mark it as sold silently to remove from PnLPage active list
      isMainSold = true;
      
      setTradeHistory(th => [{
        id: `sim-sell-${Date.now()}`,
        mint: mint,
        buyTime: pos.entryTime,
        sellTime: Date.now(),
        buyAmountSol: pos.solSpent,
        sellAmountSol: pos.solSpent * (1 + pnlPct), 
        pnlPct: pnlPct * 100
      }, ...th]);
    }

    // Real sell for Simreal active positions if privateKey is active"""

content = content.replace(old_block, new_block)

# We also need to skip the rest of the main sell block if it was already sold (transferred)
# Currently it says:
# if (shouldSellMain) {
#   if (privateKey && pos.txid && !pos.txid.includes('sim')) {

old_main_sell = """    // --- EXECUTE MAIN POSITION SELL ---
    if (shouldSellMain) {"""

new_main_sell = """    // --- EXECUTE MAIN POSITION SELL ---
    if (shouldSellMain && !isMainSold) {"""

content = content.replace(old_main_sell, new_main_sell)

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)
