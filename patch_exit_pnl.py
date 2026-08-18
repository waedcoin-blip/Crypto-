import re

with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

old_cb = "    exitMgr.setOnExitCallback((mint, side, signature, pnlPct) => {"
new_cb = "    exitMgr.setOnExitCallback((mint, side, signature, pnlPct, outputAmountSol) => {"

old_calc = """        // Update trade history and stats
        const costBasisSol = pos.solSpent || 0;
        const actualPnlSOL = costBasisSol > 0 ? (costBasisSol * pnlPct / 100) : 0;
        const actualSolReceived = Math.max(0, costBasisSol + actualPnlSOL);"""

new_calc = """        // Update trade history and stats
        const costBasisSol = pos.solSpent || 0;
        const actualSolReceived = outputAmountSol !== undefined ? outputAmountSol : Math.max(0, costBasisSol + (costBasisSol * pnlPct / 100));
        const actualPnlSOL = actualSolReceived - costBasisSol;
        // recalculate pnlPct purely based on actual real return
        pnlPct = costBasisSol > 0 ? (actualPnlSOL / costBasisSol) * 100 : pnlPct;"""

content = content.replace(old_cb, new_cb).replace(old_calc, new_calc)

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)
