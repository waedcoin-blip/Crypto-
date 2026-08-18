with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

old_sync = """          positionExitManagerRef.current.addPosition({
            mint,
            amount: pos.amountLamports || Math.floor((pos.amount || 0) * 1e6),
            buyPrice: pos.buyPrice || 0,
            solSpent: pos.solSpent || 0.1,
            tpPct: configRef.current.minTakeProfit || 25,
            slPct: configRef.current.stopLossPct || 15,
          });"""

new_sync = """          positionExitManagerRef.current.addPosition({
            mint,
            amount: pos.amountLamports || Math.floor((pos.amount || 0) * (pos.decimals ? Math.pow(10, pos.decimals) : 1e6)),
            buyPrice: pos.buyPrice || 0,
            solSpent: pos.solSpent || 0.1,
            tpPct: pos.tpPct ?? (configRef.current.minTakeProfit || 25),
            slPct: pos.slPct ?? (configRef.current.stopLossPct || 15),
          });"""

content = content.replace(old_sync, new_sync)

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)
