import re

with open('src/App.tsx', 'r') as f:
    code = f.read()

# 1. Update handleManualBuy
manual_buy_regex = re.compile(r'(const handleManualBuy = async \(tokenAddress: string, symbol: string\) => \{.+?try \{)(.+?)(      const security = await fetchTokenSecurityData\(tokenAddress\);)', re.DOTALL)

def replace_manual_buy(match):
    prefix = match.group(1)
    suffix = match.group(3)
    
    new_logic = """
      let signature = 'SIM_MANUAL_BUY_' + Math.random().toString(36).substring(7);
      let isSimulated = !isLiveTrading;
      const lamports = Math.floor(buyAmountSol * 1_000_000_000);
      const liquidityUsd = tokenMetrics[tokenAddress]?.liquidity || 0;
      
      const quote = await getJupiterQuote(
        'So11111111111111111111111111111111111111112', // SOL
        tokenAddress,
        lamports,
        liquidityUsd
      );
      if (!quote) throw new Error("Jupiter returned no quote (MARKET_NOT_FOUND).");

      let outTokensRaw = quote.outAmount;

      if (isLiveTrading) {
        if (!sessionWallet && !publicKey) {
          throw new Error("No wallet connected for Live Trading");
        }
        const walletAddress = sessionWallet ? sessionWallet.publicKey.toBase58() : publicKey!.toBase58();
        const solBalance = await connection.getBalance(new PublicKey(walletAddress));
        
        if (solBalance < lamports) {
          addNotification("Insufficient real SOL balance. Falling back to Simulation Trade.");
          isSimulated = true;
        } else {
          const priorityTipLamports = 2000000;
          if (sessionWallet) {
            const tx = await createJupiterSwapTransaction(sessionWallet.publicKey.toBase58(), quote, priorityTipLamports, connection);
            if (tx) {
              tx.sign([sessionWallet]);
              signature = await executeTxWithRPCFallback(tx, connection);
            } else throw new Error("Failed to create swap transaction");
          } else if (publicKey && sendTransaction) {
            const tx = await createJupiterSwapTransaction(publicKey.toBase58(), quote, priorityTipLamports, connection);
            if (tx) {
              signature = await sendTransaction(tx as any, connection);
              const latestBlockhash = await connection.getLatestBlockhash('confirmed');
              const confirmation = await connection.confirmTransaction({ signature, blockhash: latestBlockhash.blockhash, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight }, 'confirmed');
              if (confirmation.value.err) throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            } else throw new Error("Failed to create swap transaction");
          }
        }
      }

      if (isSimulated) {
        const simLatency = 150 + Math.random() * 1200;
        await new Promise(resolve => setTimeout(resolve, simLatency));
        if (Math.random() < 0.002) {
          throw new Error("SIM: Transaction not included — try increasing Jito tip");
        }
        if (simulationBalance < buyAmountSol) {
          throw new Error("SIM: Insufficient simulation balance");
        }
        setSimulationBalance(prev => prev - buyAmountSol);
      }
"""
    return prefix + new_logic + suffix

code = manual_buy_regex.sub(replace_manual_buy, code)

# Fix setActivePositions in handleManualBuy
set_active_regex = re.compile(r'(setActivePositions\(\s*prev => \{\s*return \{\s*\.\.\.prev,\s*\[tokenAddress\]: \{)(.+?)(\}\s*\};\s*\}\);)', re.DOTALL)
# wait, manual_buy uses setActivePositions like this:
manual_active_regex = re.compile(r'(setActivePositions\(prev => \{\s*return \{\s*\.\.\.prev,\s*\[tokenAddress\]: \{\s*boughtAt: Date.now\(\),\s*amount: entryCost,)(.+?)(\}\s*\};\s*\}\);)', re.DOTALL)

def replace_manual_active(match):
    return match.group(1) + "\n            tokenQuantityRaw: outTokensRaw," + match.group(2) + match.group(3)

code = manual_active_regex.sub(replace_manual_active, code)


# 2. Update executeAutoTrade
auto_buy_regex = re.compile(r'(try \{\s*let signature = \'SIM_BN_\' \+ Math\.random\(\)\.toString\(36\)\.substring\(7\);\s*let isSimulated = !isLiveTrading;)(.+?)(// Force fresh price for accuracy)', re.DOTALL)

def replace_auto_buy(match):
    prefix = match.group(1)
    suffix = match.group(3)
    new_logic = """
      const lamports = Math.floor(actualBuyAmountSol * 1_000_000_000);
      const liquidityUsd = tokenMetrics[tokenAddress]?.liquidity || 0;
      
      const quote = await getJupiterQuote(
        'So11111111111111111111111111111111111111112', // SOL
        tokenAddress,
        lamports,
        liquidityUsd
      );
      if (!quote) throw new Error("Token not yet listed, indexed, or no routes available on Jupiter (MARKET_NOT_FOUND / NO_ROUTES_FOUND).");
      let outTokensRaw = quote.outAmount;

      if (isLiveTrading) {
        if (!sessionWallet && !publicKey) {
          throw new Error("No wallet connected for Live Trading");
        }
        const walletAddress = sessionWallet ? sessionWallet.publicKey.toBase58() : publicKey!.toBase58();
        const solBalance = await connection.getBalance(new PublicKey(walletAddress));
                
        if (solBalance < lamports) {
          addNotification("⚠️ Insufficient real SOL balance. Falling back to Simulation mode.");
          isSimulated = true;
        } else {
            const priorityTipLamports = 2000000;
            if (sessionWallet) {
              const tx = await createJupiterSwapTransaction(sessionWallet.publicKey.toBase58(), quote, priorityTipLamports, connection);
              if (tx) {
                tx.sign([sessionWallet]);
                signature = await executeTxWithRPCFallback(tx, connection);
                console.log("🚀 Swap Executed! Transaction Signature:", signature);
              } else throw new Error("Failed to create swap transaction");
            } else if (publicKey && sendTransaction) {
              const tx = await createJupiterSwapTransaction(publicKey.toBase58(), quote, priorityTipLamports, connection);
              if (tx) {
                signature = await sendTransaction(tx as any, connection);
                const latestBlockhash = await connection.getLatestBlockhash('confirmed');
                const confirmation = await connection.confirmTransaction({ signature, blockhash: latestBlockhash.blockhash, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight }, 'confirmed');
                if (confirmation.value.err) throw new Error(`Transaction failed to confirm: ${JSON.stringify(confirmation.value.err)}`);
                console.log("🚀 Swap Executed! Transaction Signature:", signature);
              } else throw new Error("Failed to create swap transaction");
            }
        }
      }

      if (isSimulated) {
        const simLatency = 150 + Math.random() * 1200;
        await new Promise(resolve => setTimeout(resolve, simLatency));
        if (Math.random() < 0.002) {
          throw new Error("SIM: Transaction not included — try increasing Jito tip");
        }
        if (simulationBalance < actualBuyAmountSol) {
          throw new Error("SIM: Insufficient simulation balance — top up via Settings.");
        }
        setSimulationBalance(prev => prev - actualBuyAmountSol);
      }
      
      """
    return prefix + new_logic + suffix

code = auto_buy_regex.sub(replace_auto_buy, code)

# Update setActivePositions for executeAutoTrade
auto_active_regex = re.compile(r'(boughtAt: existing \? existing.boughtAt : Date\.now\(\),\s*amount: newAmount,\s*symbol: symbol,)(.+?)(entryPrice: newEntryPriceUsd,)', re.DOTALL)
def replace_auto_active(match):
    return match.group(1) + "\n            tokenQuantityRaw: existing && existing.tokenQuantityRaw ? (BigInt(existing.tokenQuantityRaw) + BigInt(outTokensRaw)).toString() : outTokensRaw," + match.group(2) + match.group(3)
code = auto_active_regex.sub(replace_auto_active, code)


# 3. Update executeAutoSell
auto_sell_regex = re.compile(r'(try \{\s*let signature = \'SIM_SELL_\' \+ Math\.random\(\)\.toString\(36\)\.substring\(7\);\s*let isSimulated = !isLiveTrading;)(.+?)(const guaranteedMinLamports = Number\(quote\.otherAmountThreshold\);)', re.DOTALL)
def replace_auto_sell(match):
    prefix = match.group(1)
    suffix = match.group(3)
    new_logic = """
      const walletAddress = (isLiveTrading && (sessionWallet || publicKey)) 
         ? (sessionWallet ? sessionWallet.publicKey.toBase58() : publicKey!.toBase58())
         : '11111111111111111111111111111111';
      if (isLiveTrading && !sessionWallet && !publicKey) {
         throw new Error("No wallet connected for Live Trading");
      }
      let balanceRaw: string | number = 0;
      if (isLiveTrading) {
          balanceRaw = await getTokenBalanceRaw(connection, walletAddress, tokenAddress);
          if (balanceRaw === '0') isSimulated = true;
      } else {
          balanceRaw = position.tokenQuantityRaw || Math.floor(position.amount * 1_000_000);
      }
      if (balanceRaw === '0' || balanceRaw === 0) {
          pendingTrades.current.delete(tokenAddress);
          return;
      }
      const quote = cachedQuote || await getJupiterQuote(
        tokenAddress, 
        'So11111111111111111111111111111111111111112', 
        Number(balanceRaw), 
        metric?.liquidity || 0,
        curPnLPercent > minTakeProfit ? (position.entryPriceSol || 0.1) : undefined,
        curPnLPercent > minTakeProfit ? minTakeProfit : undefined,
        curPnLPercent
      );
      
      if (!quote) throw new Error("No route for sell execution");
      """
    return prefix + new_logic + suffix

code = auto_sell_regex.sub(replace_auto_sell, code)

# 4. Update executePartialSell
partial_sell_regex = re.compile(r'(try \{\s*let signature = \'SIM_SELL_\' \+ Math\.random\(\)\.toString\(36\)\.substring\(7\);\s*let isSimulated = !isLiveTrading;)(.+?)(const guaranteedMinLamports = Number\(quote\.otherAmountThreshold\);)', re.DOTALL)
def replace_partial_sell(match):
    prefix = match.group(1)
    suffix = match.group(3)
    new_logic = """
      const walletAddress = (isLiveTrading && (sessionWallet || publicKey)) 
         ? (sessionWallet ? sessionWallet.publicKey.toBase58() : publicKey!.toBase58())
         : '11111111111111111111111111111111';
      let balanceRaw: string | number = 0;
      if (isLiveTrading) {
          balanceRaw = await getTokenBalanceRaw(connection, walletAddress, tokenAddress);
          if (balanceRaw === '0') isSimulated = true;
      } else {
          balanceRaw = position.tokenQuantityRaw || Math.floor(position.amount * 1_000_000);
      }
      const sellRawAmount = Math.floor(Number(balanceRaw) * (percent / 100.0));
      if (sellRawAmount <= 0) {
          pendingTrades.current.delete(tokenAddress);
          return;
      }
      const quote = await getJupiterQuote(
        tokenAddress, 
        'So11111111111111111111111111111111111111112', 
        sellRawAmount, 
        metric?.liquidity || 0,
        curPnLPercent > minTakeProfit ? (position.entryPriceSol || 0.1) : undefined,
        curPnLPercent > minTakeProfit ? minTakeProfit : undefined,
        curPnLPercent
      );
      if (!quote) throw new Error("No route for partial sell execution");
      """
    return prefix + new_logic + suffix

code = partial_sell_regex.sub(replace_partial_sell, code)

# Wait, we need to update activePositions logic in partial sell:
# amount: position.amount * (1 - (percent / 100.0)),
# We should also update tokenQuantityRaw!
partial_active_regex = re.compile(r'(amount: position\.amount \* \(1 - \(percent \/ 100\.0\)\),)(.+?)(soldPartial: true,)', re.DOTALL)
def replace_partial_active(match):
    return match.group(1) + "\n            tokenQuantityRaw: position.tokenQuantityRaw ? (BigInt(position.tokenQuantityRaw) - BigInt(sellRawAmount)).toString() : undefined," + match.group(2) + match.group(3)
code = partial_active_regex.sub(replace_partial_active, code)

with open('src/App.tsx', 'w') as f:
    f.write(code)

