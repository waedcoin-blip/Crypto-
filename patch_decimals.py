with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

old_next_sim = """              txid: finalSimTxId,
              tpPct: existing?.tpPct ?? (configRef.current.minTakeProfit || 25),
              slPct: existing?.slPct ?? (configRef.current.stopLossPct || 15)
            }"""

new_next_sim = """              txid: finalSimTxId,
              tpPct: existing?.tpPct ?? (configRef.current.minTakeProfit || 25),
              slPct: existing?.slPct ?? (configRef.current.stopLossPct || 15),
              decimals: existing?.decimals ?? (estimatedDecimals ?? fallbackDecimals ?? 6)
            }"""
content = content.replace(old_next_sim, new_next_sim)

old_next_real = """               txid: result.txid,
               tpPct: existing?.tpPct ?? (configRef.current.minTakeProfit || 25),
               slPct: existing?.slPct ?? (configRef.current.stopLossPct || 15)
             }"""
new_next_real = """               txid: result.txid,
               tpPct: existing?.tpPct ?? (configRef.current.minTakeProfit || 25),
               slPct: existing?.slPct ?? (configRef.current.stopLossPct || 15),
               decimals: existing?.decimals ?? (decimals ?? 6)
             }"""
content = content.replace(old_next_real, new_next_real)

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)
