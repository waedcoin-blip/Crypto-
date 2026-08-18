import re

with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

# Replace the simulation wallet logic
old_sim_logic = """      // Simulation wallet logic
      const deducted = true;
      if (!deducted) {
        const availableBalance = useBalanceStore.getState().solBalance;
        addLog(`Insufficient SIM balance (${availableBalance.toFixed(4)} < ${solAmount.toFixed(4)}) for ${symbol}`, 'err');
        pendingBuyMintsRef.current.delete(mint);
        return;
      }"""

new_sim_logic = """      // Simulation wallet logic via unified singleton
      const simExecutor = getSimExecutor(simWalletBalance || 1.0, jupRpcUrlToUse);
      const availableBalance = await simExecutor.getSolBalance();
      if (solAmount > availableBalance) {
        addLog(`Insufficient SIM balance (${availableBalance.toFixed(4)} < ${solAmount.toFixed(4)}) for ${symbol}`, 'err');
        pendingBuyMintsRef.current.delete(mint);
        return;
      }"""

content = content.replace(old_sim_logic, new_sim_logic)

# Replace the txid assignment and perform manual swap
old_sim_tx = """              txid: `sim-${Date.now()}`,"""
new_sim_tx = """              txid: finalSimTxId,"""

# Add the manual swap execution right before setPositions
old_set_pos = """        pipelineCountersRef.current.simBuySuccess++;

        setPositions((prev) => {"""

new_set_pos = """        const finalSimTxId = simExecutor.executeManualSwap(
          SOL_MINT,
          mint,
          solAmount,
          outAmountRaw,
          'entry'
        );
        pipelineCountersRef.current.simBuySuccess++;

        setPositions((prev) => {"""

content = content.replace(old_set_pos, new_set_pos)
content = content.replace(old_sim_tx, new_sim_tx)


# Add TP/SL explicit save in setPositions (for both SIM and REAL)
# We need to capture tpPct and slPct from configRef.current at buy time
# For simulation:
old_next_sim = """            [mint]: {
              symbol,
              buyPrice: newAmount > 0 ? (newSolSpent / newAmount) : parsedPrice,
              currentPrice: parsedPrice,
              solSpent: newSolSpent,
              amount: newAmount,
              amountLamports: existing ? (existing.amountLamports || 0) + outAmountRaw : outAmountRaw,
              entryTime: existing?.entryTime || Date.now(),
              txid: finalSimTxId,
            }"""
new_next_sim = """            [mint]: {
              symbol,
              buyPrice: newAmount > 0 ? (newSolSpent / newAmount) : parsedPrice,
              currentPrice: parsedPrice,
              solSpent: newSolSpent,
              amount: newAmount,
              amountLamports: existing ? (existing.amountLamports || 0) + outAmountRaw : outAmountRaw,
              entryTime: existing?.entryTime || Date.now(),
              txid: finalSimTxId,
              tpPct: existing?.tpPct ?? (configRef.current.minTakeProfit || 25),
              slPct: existing?.slPct ?? (configRef.current.stopLossPct || 15)
            }"""
content = content.replace(old_next_sim, new_next_sim)

# For Real:
old_next_real = """             [mint]: {
               symbol,
               buyPrice: newAmount > 0 ? (newSolSpent / newAmount) : parsedPrice,
               currentPrice: parsedPrice,
               solSpent: newSolSpent,
               amount: newAmount,
               amountLamports: existing ? (existing.amountLamports || 0) + (passedOutputAmount || 0) : (passedOutputAmount || 0),
               entryTime: existing?.entryTime || Date.now(),
               txid: result.txid,
             }"""
new_next_real = """             [mint]: {
               symbol,
               buyPrice: newAmount > 0 ? (newSolSpent / newAmount) : parsedPrice,
               currentPrice: parsedPrice,
               solSpent: newSolSpent,
               amount: newAmount,
               amountLamports: existing ? (existing.amountLamports || 0) + (passedOutputAmount || 0) : (passedOutputAmount || 0),
               entryTime: existing?.entryTime || Date.now(),
               txid: result.txid,
               tpPct: existing?.tpPct ?? (configRef.current.minTakeProfit || 25),
               slPct: existing?.slPct ?? (configRef.current.stopLossPct || 15)
             }"""
content = content.replace(old_next_real, new_next_real)

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)
