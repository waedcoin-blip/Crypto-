with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

old_str = """          positionsRef.current = next;
          return next;
        });
        addLog(`✅ [SIM] Bought ${symbol} @ ${parsedPrice.toFixed(8)} SOL (${tokenAmount.toFixed(2)} tokens)`, 'buy');"""

new_str = """          positionsRef.current = next;
          return next;
        });
        syncSimBalanceToStore();
        addLog(`✅ [SIM] Bought ${symbol} @ ${parsedPrice.toFixed(8)} SOL (${tokenAmount.toFixed(2)} tokens)`, 'buy');"""

content = content.replace(old_str, new_str)
with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)
