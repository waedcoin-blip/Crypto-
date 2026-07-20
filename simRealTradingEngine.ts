import { executeJupiterSwap } from '../services/jupiterSwapService';
import { TokenMetric, SniperTrade } from '../types';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface SimRealPosition {
  symbol: string;
  buyPrice: number;
  currentPrice: number;
  solSpent: number;
  amount: number;
  amountLamports?: number;
  decimals?: number;
  entryTime: number;
  txid: string;
  simRealBought: boolean;
  simRealBoughtPriceSol: number;
  simRealAmountTokens: number;
  simRealSolSpent: number;
  simRealBoughtTime: number;
  simRealIsVirtualFallback?: boolean;
}

export class SimRealTradingEngine {
  private static instance: SimRealTradingEngine;
  private logs: Array<{ id: string; timestamp: number; type: string; message: string }> = [];

  public static getInstance(): SimRealTradingEngine {
    if (!SimRealTradingEngine.instance) {
      SimRealTradingEngine.instance = new SimRealTradingEngine();
    }
    return SimRealTradingEngine.instance;
  }

  public getLogs() {
    return this.logs;
  }

  private addLog(message: string, type: 'INFO' | 'SUCCESS' | 'ERROR' | 'WARNING') {
    const log = {
      id: `engine-log-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      timestamp: Date.now(),
      type,
      message
    };
    this.logs.unshift(log);
    console.log(`[SimRealTradingEngine] [${type}] ${message}`);
  }

  /**
   * Executes a simulated or real-money buy order.
   */
  public async executeBuy({
    mint,
    amountSol,
    privateKey,
    apiKey,
    rpcUrl,
    slippage,
    tokenMetrics,
    updateState
  }: {
    mint: string;
    amountSol: number;
    privateKey: string;
    apiKey?: string;
    rpcUrl: string;
    slippage: number;
    tokenMetrics: Record<string, TokenMetric>;
    updateState: (update: {
      balanceOffset: number;
      newTrade: SniperTrade;
      newPosition: SimRealPosition;
    }) => void;
  }): Promise<void> {
    const cleanMint = mint.trim();
    if (!cleanMint) throw new Error("Token address is empty.");

    this.addLog(`Initiating manual SimReal BUY for ${cleanMint.slice(0, 8)}...`, 'INFO');

    let symbol = 'UNKNOWN';
    let currentPrice = 0;
    const existingMetric = tokenMetrics[cleanMint];

    if (existingMetric) {
      symbol = existingMetric.symbol || 'UNKNOWN';
      currentPrice = existingMetric.priceNative || 0;
    }

    const quoteRequestTime = Date.now();
    const isRealMoney = !!privateKey;

    if (isRealMoney) {
      this.addLog(`[REAL SWAP] Executing direct buy via Jupiter on-chain...`, 'INFO');
      try {
        const amountLamports = Math.floor(amountSol * 1_000_000_000);
        const result = await executeJupiterSwap({
          inputMint: SOL_MINT,
          outputMint: cleanMint,
          amount: amountLamports,
          privateKey,
          apiKey,
          jupRpcUrl: rpcUrl,
          slippage
        });

        if (result.txid) {
          // result.outputAmount is expected to be the raw atomic (base-unit) amount
          // returned by Jupiter, so it must be divided by 10^decimals to get a
          // human-readable token quantity. Falling back to raw units silently
          // corrupts price/PnL math for any token that isn't the assumed decimals.
          const decimals = existingMetric?.decimals ?? tokenMetrics[cleanMint]?.decimals;
          if (decimals === undefined) {
            this.addLog(
              `No decimals found for ${cleanMint.slice(0, 8)}; assuming 6. Verify tokenMetrics includes 'decimals'.`,
              'WARNING'
            );
          }
          const resolvedDecimals = decimals ?? 6;
          const rawOutputAmount = result.outputAmount;
          const exactTokenAmount = rawOutputAmount / Math.pow(10, resolvedDecimals);
          const boughtPriceSol = amountSol / (exactTokenAmount || 0.000001);

          const newTrade: SniperTrade = {
            id: `simreal-buy-${Date.now()}`,
            type: 'BUY',
            token: symbol,
            address: cleanMint,
            amount: amountSol,
            timestamp: quoteRequestTime,
            signature: result.txid,
            tokenAmount: exactTokenAmount
          };

          const newPosition: SimRealPosition = {
            symbol,
            buyPrice: boughtPriceSol,
            currentPrice: currentPrice || boughtPriceSol,
            solSpent: amountSol,
            amount: exactTokenAmount,
            decimals: resolvedDecimals,
            entryTime: quoteRequestTime,
            txid: result.txid,
            simRealBought: true,
            simRealBoughtPriceSol: boughtPriceSol,
            simRealAmountTokens: exactTokenAmount,
            simRealSolSpent: amountSol,
            simRealBoughtTime: quoteRequestTime,
            // Store the raw atomic amount (not the human-readable amount) so the
            // sell path can pass it straight back to Jupiter without re-deriving it.
            amountLamports: rawOutputAmount
          };

          updateState({
            balanceOffset: -amountSol,
            newTrade,
            newPosition
          });

          this.addLog(`Successfully executed real buy for ${symbol}: ${result.txid.slice(0, 10)}...`, 'SUCCESS');
        } else {
          throw new Error("Jupiter swap transaction ID was not returned.");
        }
      } catch (err: any) {
        this.addLog(`Real swap failed: ${err.message}`, 'ERROR');
        throw err;
      }
    } else {
      // Simulation mode
      const tokensQty = amountSol / (currentPrice || 0.000001);
      const newTrade: SniperTrade = {
        id: `simreal-buy-${Date.now()}`,
        type: 'BUY',
        token: symbol,
        address: cleanMint,
        amount: amountSol,
        timestamp: quoteRequestTime,
        signature: 'SIMREAL_BN_' + Math.random().toString(36).substring(7),
        tokenAmount: tokensQty
      };

      const newPosition: SimRealPosition = {
        symbol,
        buyPrice: currentPrice || 0.000001,
        currentPrice: currentPrice || 0.000001,
        solSpent: amountSol,
        amount: tokensQty,
        entryTime: quoteRequestTime,
        txid: 'simulation-copy',
        simRealBought: true,
        simRealBoughtPriceSol: currentPrice || 0.000001,
        simRealAmountTokens: tokensQty,
        simRealSolSpent: amountSol,
        simRealBoughtTime: quoteRequestTime,
        simRealIsVirtualFallback: true
      };

      updateState({
        balanceOffset: -amountSol,
        newTrade,
        newPosition
      });

      this.addLog(`Simulated buy completed for ${symbol} @ ${currentPrice} SOL`, 'SUCCESS');
    }
  }

  /**
   * Executes a simulated or real-money sell order.
   */
  public async executeSell({
    mint,
    position,
    privateKey,
    apiKey,
    rpcUrl,
    slippage,
    tokenMetrics,
    updateState
  }: {
    mint: string;
    position: any;
    privateKey: string;
    apiKey?: string;
    rpcUrl: string;
    slippage: number;
    tokenMetrics: Record<string, TokenMetric>;
    updateState: (update: {
      balanceOffset: number;
      newTrade: SniperTrade;
    }) => void;
  }): Promise<void> {
    const cleanMint = mint.trim();
    if (!position) throw new Error("No open position found for this token.");

    this.addLog(`Initiating manual SimReal SELL for ${position.symbol}...`, 'INFO');

    const quoteRequestTime = Date.now();
    const isRealMoney = !!privateKey;

    let sellPriceSol = position.currentPrice;
    const existingMetric = tokenMetrics[cleanMint];
    if (existingMetric) {
      sellPriceSol = existingMetric.priceNative || sellPriceSol;
    }

    if (isRealMoney) {
      this.addLog(`[REAL SWAP] Executing direct sell via Jupiter on-chain...`, 'INFO');
      try {
        // Prefer the raw atomic amount stored on the position (set correctly at
        // buy time). Only fall back to re-deriving it if that's missing, and in
        // that case use the token's actual decimals rather than a hardcoded
        // guess -- different SPL tokens use different decimal counts, and
        // assuming 6 for all of them can send Jupiter an amount that's off by
        // orders of magnitude.
        let sellAmountRaw = position.amountLamports;
        if (sellAmountRaw === undefined) {
          const decimals =
            position.decimals ?? existingMetric?.decimals ?? tokenMetrics[cleanMint]?.decimals;
          if (decimals === undefined) {
            this.addLog(
              `No decimals found for ${cleanMint.slice(0, 8)}; assuming 6. Verify tokenMetrics includes 'decimals'.`,
              'WARNING'
            );
          }
          sellAmountRaw = Math.floor(position.amount * Math.pow(10, decimals ?? 6));
        }

        const result = await executeJupiterSwap({
          inputMint: cleanMint,
          outputMint: SOL_MINT,
          amount: sellAmountRaw,
          privateKey,
          apiKey,
          jupRpcUrl: rpcUrl,
          slippage
        });

        if (result.txid) {
          const exactSolOutput = result.outputAmount / 1_000_000_000;
          const newTrade: SniperTrade = {
            id: `simreal-sell-${Date.now()}`,
            type: 'SELL',
            token: position.symbol,
            address: cleanMint,
            amount: exactSolOutput,
            timestamp: quoteRequestTime,
            signature: result.txid,
            tokenAmount: position.amount
          };

          updateState({
            balanceOffset: exactSolOutput,
            newTrade
          });

          this.addLog(`Successfully executed real sell for ${position.symbol}: ${result.txid.slice(0, 10)}...`, 'SUCCESS');
        } else {
          throw new Error("Jupiter swap transaction ID was not returned.");
        }
      } catch (err: any) {
        this.addLog(`Real swap failed: ${err.message}`, 'ERROR');
        throw err;
      }
    } else {
      // Simulation mode
      const simulatedPayout = position.amount * sellPriceSol;
      const newTrade: SniperTrade = {
        id: `simreal-sell-${Date.now()}`,
        type: 'SELL',
        token: position.symbol,
        address: cleanMint,
        amount: simulatedPayout,
        timestamp: quoteRequestTime,
        signature: 'SIMREAL_SL_' + Math.random().toString(36).substring(7),
        tokenAmount: position.amount
      };

      updateState({
        balanceOffset: simulatedPayout,
        newTrade
      });

      this.addLog(`Simulated sell completed for ${position.symbol} @ ${sellPriceSol} SOL`, 'SUCCESS');
    }
  }
}

export const simRealTradingEngine = SimRealTradingEngine.getInstance();
