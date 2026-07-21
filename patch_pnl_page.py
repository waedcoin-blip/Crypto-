with open('src/components/pages/PnLPage.tsx', 'r') as f:
    pnl = f.read()

# 1. Update setPositions in simulated buy path (around line 2613)
old_sim_buy_setpos = """              // Now update positions state
              setPositions(prev => {
                const existing = prev[mint] || {
                  symbol: pos.symbol || 'Unknown',
                  buyPrice: boughtPriceSol,
                  currentPrice: boughtPriceSol,
                  solSpent: buyAmt,
                  amount: tokensQty,
                  entryTime: quoteRequestTime,
                  txid: 'simulation-copy'
                };
                return {
                  ...prev,
                  [mint]: {
                    ...existing,
                    simRealBought: true,
                    simRealBoughtPriceSol: boughtPriceSol,
                    simRealAmountTokens: tokensQty,
                    simRealSolSpent: buyAmt,
                    simRealBoughtTime: quoteRequestTime,
                    simRealIsVirtualFallback: isFallbackSim ? true : undefined
                  }
                };
              });"""

new_sim_buy_setpos = """              // Now update positions state
              setPositions(prev => {
                const existing = prev[mint] || {
                  symbol: pos.symbol || 'Unknown',
                  buyPrice: boughtPriceSol,
                  currentPrice: boughtPriceSol,
                  solSpent: buyAmt,
                  amount: tokensQty,
                  entryTime: quoteRequestTime,
                  txid: 'simulation-copy'
                };
                const updated = {
                  ...existing,
                  simRealBought: true,
                  simRealBoughtPriceSol: boughtPriceSol,
                  simRealAmountTokens: tokensQty,
                  simRealSolSpent: buyAmt,
                  simRealBoughtTime: quoteRequestTime,
                  simRealIsVirtualFallback: isFallbackSim ? true : undefined
                };
                positionsRef.current = {
                  ...prev,
                  [mint]: updated
                };
                return positionsRef.current;
              });"""

if old_sim_buy_setpos in pnl:
    pnl = pnl.replace(old_sim_buy_setpos, new_sim_buy_setpos)
    print("1. Simulated buy setPositions patched")
else:
    print("WARNING: 1. old_sim_buy_setpos not found")

# 2. Update executeSell simRealNetPnlPct (around line 4043)
old_exec_sell_calc = """    let simRealNetPnlPct = 0;
    if (pos.simRealBought && pos.simRealSolSpent) {
      const simRealGross = currentPrice * (pos.simRealAmountTokens || 0);
      const simRealGrossPnLPercent = ((simRealGross - pos.simRealSolSpent) / pos.simRealSolSpent) * 100;
      let dynamicSlippage = slippage;
      if (simRealGrossPnLPercent > 0) dynamicSlippage = Math.max(0.3, Math.min(slippage, simRealGrossPnLPercent * 0.3));
      else dynamicSlippage = Math.min(slippage, 1.0);
      
      const slippageFeeCalc = simRealGross * (dynamicSlippage / 100);
      const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, pos.simRealSolSpent || 0.1);
      const simRealNetSolReturn = Math.max(0, simRealGross - slippageFeeCalc - opFees);
      simRealNetPnlPct = (simRealNetSolReturn - pos.simRealSolSpent) / pos.simRealSolSpent;
    }"""

new_exec_sell_calc = """    let simRealNetPnlPct = 0;
    if (pos.simRealBought && (pos.simRealSolSpent || pos.solSpent)) {
      const spentSol = pos.simRealSolSpent || pos.solSpent || 0.1;
      const boughtPrice = pos.simRealBoughtPriceSol || pos.buyPrice || pos.currentPrice || 0.000001;
      const currPrice = currentPrice || pos.currentPrice || pos.buyPrice || boughtPrice;
      const tokensQty = (pos.simRealAmountTokens && pos.simRealAmountTokens > 0)
        ? pos.simRealAmountTokens
        : (pos.amount && pos.amount > 0)
        ? pos.amount
        : (spentSol / boughtPrice);

      const simRealGross = currPrice * tokensQty;
      const simRealGrossPnLPercent = ((simRealGross - spentSol) / spentSol) * 100;
      let dynamicSlippage = slippage;
      if (simRealGrossPnLPercent > 0) dynamicSlippage = Math.max(0.3, Math.min(slippage, simRealGrossPnLPercent * 0.3));
      else dynamicSlippage = Math.min(slippage, 1.0);
      
      const slippageFeeCalc = simRealGross * (dynamicSlippage / 100);
      const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol);
      const simRealNetSolReturn = Math.max(0, simRealGross - slippageFeeCalc - opFees);
      simRealNetPnlPct = (simRealNetSolReturn - spentSol) / spentSol;
    }"""

if old_exec_sell_calc in pnl:
    pnl = pnl.replace(old_exec_sell_calc, new_exec_sell_calc)
    print("2. executeSell simRealNetPnlPct patched")
else:
    print("WARNING: 2. old_exec_sell_calc not found")

# 3. Update executeSell simReal fallback sell (around line 4335)
old_exec_sell_fallback = """          const currentGrossSimReal = currentPrice * (pos.simRealAmountTokens || 0);
          const currentPnLPercent = (((currentGrossSimReal - (pos.simRealSolSpent || 0.1)) / (pos.simRealSolSpent || 0.1)) * 100);
          let dynamicSlippage = slippage;
          if (currentPnLPercent > 0) dynamicSlippage = Math.max(0.3, Math.min(slippage, currentPnLPercent * 0.3));
          else dynamicSlippage = Math.min(slippage, 1.0);
          
          const slippageFeeCalc = currentGrossSimReal * (dynamicSlippage / 100);
          const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, pos.simRealSolSpent || 0.1);
          sellAmtSol = Math.max(0, currentGrossSimReal - slippageFeeCalc - opFees);
          tradePnlPct = (sellAmtSol - (pos.simRealSolSpent || 0.1)) / (pos.simRealSolSpent || 0.1);"""

new_exec_sell_fallback = """          const spentSol = pos.simRealSolSpent || pos.solSpent || 0.1;
          const boughtPrice = pos.simRealBoughtPriceSol || pos.buyPrice || pos.currentPrice || 0.000001;
          const currPrice = currentPrice || pos.currentPrice || pos.buyPrice || boughtPrice;
          const tokensQty = (pos.simRealAmountTokens && pos.simRealAmountTokens > 0)
            ? pos.simRealAmountTokens
            : (pos.amount && pos.amount > 0)
            ? pos.amount
            : (spentSol / boughtPrice);

          const currentGrossSimReal = currPrice * tokensQty;
          const currentPnLPercent = (((currentGrossSimReal - spentSol) / spentSol) * 100);
          let dynamicSlippage = slippage;
          if (currentPnLPercent > 0) dynamicSlippage = Math.max(0.3, Math.min(slippage, currentPnLPercent * 0.3));
          else dynamicSlippage = Math.min(slippage, 1.0);
          
          const slippageFeeCalc = currentGrossSimReal * (dynamicSlippage / 100);
          const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol);
          sellAmtSol = Math.max(0, currentGrossSimReal - slippageFeeCalc - opFees);
          tradePnlPct = (sellAmtSol - spentSol) / spentSol;"""

if old_exec_sell_fallback in pnl:
    pnl = pnl.replace(old_exec_sell_fallback, new_exec_sell_fallback)
    print("3. executeSell fallback patched")
else:
    print("WARNING: 3. old_exec_sell_fallback not found")

# 4. Strategy Check Blocks (around line 4777 and 4867)
old_strategy_block = """            let simRealNetPnlPct = 0;
            if (pos.simRealBought && pos.simRealSolSpent) {
              const simRealGross = currentPrice * (pos.simRealAmountTokens || 0);
              let simRealNetSolReturn = simRealGross;
              
              if (typeof quote !== 'undefined' && quote && pos.amountLamports && pos.amount) {
                 const guaranteedMinLamports = BigInt(quote.otherAmountThreshold);
                 const guaranteedSolOut = Number(guaranteedMinLamports) / 1_000_000_000.0;
                 const ratio = (pos.simRealAmountTokens || 0) / pos.amount;
                 const scaledSolOut = guaranteedSolOut * ratio;
                 const operationalFeesSol = getDynamicOperationalFeeSol(pos.recoveryMode, pos.simRealSolSpent); 
                 simRealNetSolReturn = Math.max(0, scaledSolOut - operationalFeesSol);
              } else {
                 const simRealGrossPnLPercent = ((simRealGross - pos.simRealSolSpent) / pos.simRealSolSpent) * 100;
                 let dynamicSlippage = slippage;
                 if (simRealGrossPnLPercent > 0) dynamicSlippage = Math.max(0.3, Math.min(slippage, simRealGrossPnLPercent * 0.3));
                 else dynamicSlippage = Math.min(slippage, 1.0);
                 const slippageFeeCalc = simRealGross * (dynamicSlippage / 100);
                 const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, pos.simRealSolSpent || 0.1);
                 simRealNetSolReturn = Math.max(0, simRealGross - slippageFeeCalc - opFees);
              }
              simRealNetPnlPct = (simRealNetSolReturn - pos.simRealSolSpent) / pos.simRealSolSpent;
            }"""

new_strategy_block = """            let simRealNetPnlPct = 0;
            if (pos.simRealBought && (pos.simRealSolSpent || pos.solSpent)) {
              const spentSol = pos.simRealSolSpent || pos.solSpent || 0.1;
              const boughtPrice = pos.simRealBoughtPriceSol || pos.buyPrice || pos.currentPrice || 0.000001;
              const currPrice = currentPrice || pos.currentPrice || pos.buyPrice || boughtPrice;
              const tokensQty = (pos.simRealAmountTokens && pos.simRealAmountTokens > 0)
                ? pos.simRealAmountTokens
                : (pos.amount && pos.amount > 0)
                ? pos.amount
                : (spentSol / boughtPrice);

              const simRealGross = currPrice * tokensQty;
              let simRealNetSolReturn = simRealGross;
              
              if (typeof quote !== 'undefined' && quote && pos.amountLamports && pos.amount) {
                 const guaranteedMinLamports = BigInt(quote.otherAmountThreshold);
                 const guaranteedSolOut = Number(guaranteedMinLamports) / 1_000_000_000.0;
                 const ratio = tokensQty / (pos.amount || tokensQty);
                 const scaledSolOut = guaranteedSolOut * ratio;
                 const operationalFeesSol = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol); 
                 simRealNetSolReturn = Math.max(0, scaledSolOut - operationalFeesSol);
              } else {
                 const simRealGrossPnLPercent = ((simRealGross - spentSol) / spentSol) * 100;
                 let dynamicSlippage = slippage;
                 if (simRealGrossPnLPercent > 0) dynamicSlippage = Math.max(0.3, Math.min(slippage, simRealGrossPnLPercent * 0.3));
                 else dynamicSlippage = Math.min(slippage, 1.0);
                 const slippageFeeCalc = simRealGross * (dynamicSlippage / 100);
                 const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol);
                 simRealNetSolReturn = Math.max(0, simRealGross - slippageFeeCalc - opFees);
              }
              simRealNetPnlPct = (simRealNetSolReturn - spentSol) / spentSol;
            }"""

pnl_count = pnl.count(old_strategy_block)
if pnl_count > 0:
    pnl = pnl.replace(old_strategy_block, new_strategy_block)
    print(f"4. Strategy block patched ({pnl_count} occurrences)")
else:
    print("WARNING: 4. old_strategy_block not found")

# 5. executeSimRealSell (around line 5570)
old_exec_simreal_sell = """      try {
        const lamportsToSell = pos.amountLamports || Math.floor((pos.simRealAmountTokens || 0) * 1_000_000);
        if (lamportsToSell > 0) {
          const currentPrice = pos.currentPrice || pos.buyPrice || 0;
          const tokensQty = pos.simRealAmountTokens || 0;
          const simRealGross = currentPrice * tokensQty;
          const simRealGrossPnLPercent = ((simRealGross - (pos.simRealSolSpent || 0.1)) / (pos.simRealSolSpent || 0.1)) * 100;
          let dynamicSlippage = slippage;
          if (simRealGrossPnLPercent > 0) dynamicSlippage = Math.max(0.3, Math.min(slippage, simRealGrossPnLPercent * 0.3));
          else dynamicSlippage = Math.min(slippage, 1.0);
          const slippageBps = Math.floor(dynamicSlippage * 100);
          
          const opFeesSol = getDynamicOperationalFeeSol(pos.recoveryMode, pos.simRealSolSpent || 0.1);
          // If it's a stop loss or emergency, we don't enforce profit guard! We only enforce if we expect it to be a +pnl sell.
          const isStopLossSignal = true; // Emergency force exit
          const minExpectedOut = isStopLossSignal ? undefined : ((pos.simRealSolSpent || 0) + opFeesSol);
          
          const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell, slippageBps, minExpectedOut);
          if (result.txid) {
             addLog(`✅ [SIMREAL REAL SWAP SUCCESS] Sold ${pos.symbol} on-chain | tx: ${result.txid.slice(0, 12)}...`, 'sell');
             signature = result.txid;
             const passedOutAmount = typeof result.outputAmount === 'number' && !isNaN(result.outputAmount) ? result.outputAmount : 0;
             if (passedOutAmount > 0) {
               sellAmtSol = passedOutAmount / 1_000_000_000;
             } else {
               const currentPrice = pos.currentPrice || pos.buyPrice || 0;
               const tokensQty = pos.simRealAmountTokens || 0;
               sellAmtSol = currentPrice * tokensQty;
             }
          } else {
             throw new Error("Jupiter swap transaction ID missing.");
          }
        } else {
          throw new Error("No tokens/lamports found to sell on-chain");
        }
      } catch (err: any) {
        addLog(`❌ [SIMREAL REAL SWAP FAILED] Real manual sell failed: ${err.message}. Proceeding with simulation fallback.`, 'err');
        const currentPrice = pos.currentPrice || pos.buyPrice || 0;
        const tokensQty = pos.simRealAmountTokens || 0;
        const currentGrossSimReal = currentPrice * tokensQty;
        const slippageFee = currentGrossSimReal * (slippage / 100);
        const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, pos.simRealSolSpent || 0.1);
        sellAmtSol = Math.max(0, currentGrossSimReal - slippageFee - opFees);
      }
    } else {
      const currentPrice = pos.currentPrice || pos.buyPrice || 0;
      const spentSol = pos.simRealSolSpent || 0.1;
      const tokensQty = pos.simRealAmountTokens || 0;

      // Calculate current net price if sold (including slippage if no private key)
      const currentGrossSimReal = currentPrice * tokensQty;
      const slippageFee = currentGrossSimReal * (slippage / 100);
      const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol);
      sellAmtSol = Math.max(0, currentGrossSimReal - slippageFee - opFees);
    }"""

new_exec_simreal_sell = """      const spentSol = pos.simRealSolSpent || pos.solSpent || 0.1;
      const boughtPrice = pos.simRealBoughtPriceSol || pos.buyPrice || pos.currentPrice || 0.000001;
      const currPrice = pos.currentPrice || pos.buyPrice || boughtPrice;
      const tokensQty = (pos.simRealAmountTokens && pos.simRealAmountTokens > 0)
        ? pos.simRealAmountTokens
        : (pos.amount && pos.amount > 0)
        ? pos.amount
        : (spentSol / boughtPrice);
      const lamportsToSell = pos.amountLamports || Math.floor(tokensQty * 1_000_000);

      try {
        if (lamportsToSell > 0) {
          const simRealGross = currPrice * tokensQty;
          const simRealGrossPnLPercent = ((simRealGross - spentSol) / spentSol) * 100;
          let dynamicSlippage = slippage;
          if (simRealGrossPnLPercent > 0) dynamicSlippage = Math.max(0.3, Math.min(slippage, simRealGrossPnLPercent * 0.3));
          else dynamicSlippage = Math.min(slippage, 1.0);
          const slippageBps = Math.floor(dynamicSlippage * 100);
          
          const opFeesSol = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol);
          const isStopLossSignal = true; // Emergency force exit
          const minExpectedOut = isStopLossSignal ? undefined : (spentSol + opFeesSol);
          
          const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell, slippageBps, minExpectedOut);
          if (result.txid) {
             addLog(`✅ [SIMREAL REAL SWAP SUCCESS] Sold ${pos.symbol} on-chain | tx: ${result.txid.slice(0, 12)}...`, 'sell');
             signature = result.txid;
             const passedOutAmount = typeof result.outputAmount === 'number' && !isNaN(result.outputAmount) ? result.outputAmount : 0;
             if (passedOutAmount > 0) {
               sellAmtSol = passedOutAmount / 1_000_000_000;
             } else {
               sellAmtSol = currPrice * tokensQty;
             }
          } else {
             throw new Error("Jupiter swap transaction ID missing.");
          }
        } else {
          throw new Error("No tokens/lamports found to sell on-chain");
        }
      } catch (err: any) {
        addLog(`❌ [SIMREAL REAL SWAP FAILED] Real manual sell failed: ${err.message}. Proceeding with simulation fallback.`, 'err');
        const currentGrossSimReal = currPrice * tokensQty;
        const slippageFee = currentGrossSimReal * (slippage / 100);
        const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol);
        sellAmtSol = Math.max(0, currentGrossSimReal - slippageFee - opFees);
      }
    } else {
      const spentSol = pos.simRealSolSpent || pos.solSpent || 0.1;
      const boughtPrice = pos.simRealBoughtPriceSol || pos.buyPrice || pos.currentPrice || 0.000001;
      const currPrice = pos.currentPrice || pos.buyPrice || boughtPrice;
      const tokensQty = (pos.simRealAmountTokens && pos.simRealAmountTokens > 0)
        ? pos.simRealAmountTokens
        : (pos.amount && pos.amount > 0)
        ? pos.amount
        : (spentSol / boughtPrice);

      const currentGrossSimReal = currPrice * tokensQty;
      const slippageFee = currentGrossSimReal * (slippage / 100);
      const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol);
      sellAmtSol = Math.max(0, currentGrossSimReal - slippageFee - opFees);
    }"""

if old_exec_simreal_sell in pnl:
    pnl = pnl.replace(old_exec_simreal_sell, new_exec_simreal_sell)
    print("5. executeSimRealSell patched")
else:
    print("WARNING: 5. old_exec_simreal_sell not found")

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(pnl)

print("PnLPage.tsx fully patched")
