const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const startPattern = "    // --- EXECUTE MAIN POSITION SELL ---";
const startIndex = code.indexOf(startPattern);
if (startIndex === -1) throw new Error("Could not find start");

const endPattern = "        if (actualPnlPct < 0) {";
const endIndex = code.indexOf(endPattern, startIndex);
if (endIndex === -1) throw new Error("Could not find end");

// The replacement logic
const replacement = `    // --- EXECUTE MAIN POSITION SELL ---
    if (shouldSellMain && !isMainSold) {
      if (!privateKey) {
        addLog('❌ [SELL ABORTED] No Private Key configured. A wallet is required for both Devnet and Mainnet trading.', 'err');
        return;
      }

      // Real on-chain swap sell for main
      addLog(\`🚨 [REAL SWAP SELL] Initiating real on-chain sell for main position of \${pos.symbol} via Jupiter...\`, 'warn');
      try {
        const lamportsToSellRaw = pos.amountLamports;
        let lamportsToSell = lamportsToSellRaw;
        if (!lamportsToSell || lamportsToSell <= 0) {
          try {
            const keypair = useActiveWalletStore.getState().activeWallet?.keypair;
            const activeWsUrl = (customWsUrl && customWsUrl.trim() !== "") ? customWsUrl.trim() : rpcUrl.replace('https', 'wss').replace('http', 'ws');
            const conn = new Connection(rpcUrl, { commitment: 'confirmed', wsEndpoint: activeWsUrl });
            const accounts = await conn.getParsedTokenAccountsByOwner(
              keypair.publicKey,
              { mint: new PublicKey(mint) }
            );
            if (accounts.value.length > 0) {
                lamportsToSell = parseInt(accounts.value[0].account.data.parsed.info.tokenAmount.amount, 10);
            }
          } catch (e) {
            console.warn("Failed to fetch balance for dynamic sell", e);
          }
        }

        if (!pos || !lamportsToSell || lamportsToSell <= 0) {
          addLog(\`No original token lamports for \${pos?.symbol || mint}, using fallback or removing position\`, 'warn');
          isMainSold = true;
        } else {
          addLog(\`Ordering \${pos.symbol} → SOL...\`, 'sell');
          const result = await executeJupiterSwap(mint, SOL_MINT, lamportsToSell);
          if (result.txid) {
            const actualSolReceived = result.outputAmount || 0;
            const costBasisSol = pos.solSpent || 0;
            const actualPnlSOL = costBasisSol > 0 ? actualSolReceived - costBasisSol : 0;
            const actualPnlPct = costBasisSol > 0 ? actualPnlSOL / costBasisSol : 0;
            
            setStats((s) => ({
              ...s,
              trades: s.trades + 1,
              wins: s.wins + (actualPnlPct > 0 ? 1 : 0),
              losses: s.losses + (actualPnlPct <= 0 ? 1 : 0),
              pnl: s.pnl + actualPnlSOL,
              bestTrade: (actualPnlPct > 0 && (!s.bestTrade || actualPnlPct > s.bestTrade)) ? actualPnlPct : s.bestTrade
            }));
            addLog(\`✅ Sold \${pos.symbol} on-chain | Received: \${actualSolReceived.toFixed(6)} SOL | P&L: \${(actualPnlPct * 100).toFixed(1)}% | tx: \${result.txid.slice(0, 12)}...\`, 'sell');
            
            setTradeHistory(th => [{
              id: \`trade-\${Date.now()}\`,
              mint: mint,
              buyTime: pos.entryTime,
              sellTime: Date.now(),
              buyAmountSol: costBasisSol,
              sellAmountSol: actualSolReceived,
              pnlPct: Math.max(-100, actualPnlPct * 100)
            }, ...th]);

            if (pnlPct < 0) {
              setBlacklistedMints(prev => Array.from(new Set([...prev, mint])));
              addLog(\`Blacklisted \${pos.symbol} due to negative PnL.\`, 'warn');
            }
            isMainSold = true;
            walletBalanceService.refreshNow();
          } else {
            throw new Error("Jupiter swap transaction ID missing.");
          }
        }
      } catch (e: any) {
        addLog(\`Real main sell error: \${e.message}\`, 'err');
        walletBalanceService.refreshNow();
      }
    }
    
    // Fallback for actualPnlPct < 0 block that comes after
    const actualPnlPct = pnlPct;
    if (actualPnlPct < 0) {`;

code = code.substring(0, startIndex) + replacement + code.substring(endIndex + endPattern.length);
fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log('Successfully replaced executeSell simulation branch');
