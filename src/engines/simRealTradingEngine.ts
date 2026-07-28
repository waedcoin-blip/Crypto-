import { executeJupiterSwap } from '../services/jupiterSwapService';
import { TokenMetric, SniperTrade } from '../types';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_DECIMALS = 9;

export interface SimRealPosition {
  symbol: string;
  buyPrice: number;
  currentPrice: number;
  solSpent: number;
  amount: number;           // Human-readable token amount
  amountLamports: number;   // Raw base units (for on-chain swaps)
  decimals: number;         // Token decimals (critical for correct sell amounts)
  entryTime: number;
  txid: string;
  simRealBought: boolean;
  simRealBoughtPriceSol: number;
  simRealAmountTokens: number;
  simRealSolSpent: number;
  simRealBoughtTime: number;
  simRealIsVirtualFallback?: boolean;
}

export interface SimRealLog {
  id: string;
  timestamp: number;
  type: 'INFO' | 'SUCCESS' | 'ERROR' | 'WARNING';
  message: string;
}

export class SimRealTradingEngine {
  private static instance: SimRealTradingEngine;
  private logs: SimRealLog[] = [];

  public static getInstance(): SimRealTradingEngine {
    if (!SimRealTradingEngine.instance) {
      SimRealTradingEngine.instance = new SimRealTradingEngine();
    }
    return SimRealTradingEngine.instance;
  }

  public getLogs(): readonly SimRealLog[] {
    return this.logs;
  }

  private addLog(message: string, type: SimRealLog['type']) {
    const log: SimRealLog = {
      id: `engine-log-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      timestamp: Date.now(),
      type,
      message
    };
    this.logs.unshift(log);
    console.log(`[SimRealTradingEngine] [${type}] ${message}`);
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private validateBuyInputs(mint: string, amountSol: number, rpcUrl: string, slippage: number): void {
    if (!mint || mint.trim().length === 0) {
      throw new Error("Token address is empty.");
    }
    if (amountSol <= 0 || !Number.isFinite(amountSol)) {
      throw new Error("Amount must be a positive number greater than 0.");
    }
    if (!rpcUrl || rpcUrl.trim().length === 0) {
      throw new Error("RPC URL is required.");
    }
    if (slippage < 0 || slippage > 10000) {
      throw new Error("Slippage must be between 0 and 10000 basis points.");
    }
  }

  private validateSellInputs(mint: string, position: SimRealPosition | null | undefined, rpcUrl: string, slippage: number): void {
    if (!mint || mint.trim().length === 0) {
      throw new Error("Token address is empty.");
    }
    if (!position) {
      throw new Error("No open position found for this token.");
    }
    if (!rpcUrl || rpcUrl.trim().length === 0) {
      throw new Error("RPC URL is required.");
    }
    if (slippage < 0 || slippage > 10000) {
      throw new Error("Slippage must be between 0 and 10000 basis points.");
    }
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
    this.validateBuyInputs(cleanMint, amountSol, rpcUrl, slippage);

    this.addLog(`Initiating manual SimReal BUY for ${cleanMint.slice(0, 8)}...`, 'INFO');

    let symbol = 'UNKNOWN';
    let currentPrice = 0;
    let decimals = 9; // Default to 9 (common for Solana tokens)

    const existingMetric = tokenMetrics[cleanMint];
    if (existingMetric) {
      symbol = existingMetric.symbol || 'UNKNOWN';
      currentPrice = existingMetric.priceNative || 0;
      // Attempt to read decimals from metric metadata; fallback to 9
      decimals = (existingMetric as any).decimals ?? 9;
    }

    const quoteRequestTime = Date.now();
    const isRealMoney = !!privateKey;

    if (isRealMoney) {
      this.addLog(`[REAL SWAP] Executing direct buy via Jupiter on-chain...`, 'INFO');
      try {
        const amountLamports = Math.floor(amountSol * 10 ** SOL_DECIMALS);
        const result = await executeJupiterSwap({
          inputMint: SOL_MINT,
          outputMint: cleanMint,
          amount: amountLamports,
          privateKey,
          apiKey,
          jupRpcUrl: rpcUrl,
          slippage
        });

        if (!result.txid) {
          throw new Error("Jupiter swap transaction ID was not returned.");
        }

        // Jupiter returns outputAmount in raw base units by default
        const exactTokenAmountRaw = result.outputAmount;
        const exactTokenAmountHuman = exactTokenAmountRaw / (10 ** decimals);
        const boughtPriceSol = amountSol / (exactTokenAmountHuman || 0.000001);

        const newTrade: SniperTrade = {
          id: this.generateId('simreal-buy'),
          type: 'BUY',
          token: symbol,
          address: cleanMint,
          amount: amountSol,
          timestamp: quoteRequestTime,
          signature: result.txid,
          tokenAmount: exactTokenAmountHuman
        };

        const newPosition: SimRealPosition = {
          symbol,
          buyPrice: boughtPriceSol,
          currentPrice: currentPrice || boughtPriceSol,
          solSpent: amountSol,
          amount: exactTokenAmountHuman,
          amountLamports: result.quoteOutAmountRaw ?? exactTokenAmountRaw,
          decimals,
          entryTime: quoteRequestTime,
          txid: result.txid,
          simRealBought: true,
          simRealBoughtPriceSol: boughtPriceSol,
          simRealAmountTokens: exactTokenAmountHuman,
          simRealSolSpent: amountSol,
          simRealBoughtTime: quoteRequestTime,
        };

        updateState({
          balanceOffset: -amountSol,
          newTrade,
          newPosition
        });

        this.addLog(`Successfully executed real buy for ${symbol}: ${result.txid.slice(0, 10)}...`, 'SUCCESS');
      } catch (err: any) {
        this.addLog(`Real swap failed: ${err.message}`, 'ERROR');
        throw err;
      }
    } else {
      // Simulation mode - fetch fresh price quote
      let freshPriceSol = currentPrice;
      try {
        const res = await fetch(`/api/dex/tokens/${cleanMint}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.pairs && data.pairs.length > 0) {
            const bestPair = [...data.pairs].sort((a: any, b: any) => parseFloat(b.liquidity?.usd || '0') - parseFloat(a.liquidity?.usd || '0'))[0];
            if (bestPair && parseFloat(bestPair.priceNative || '0') > 0) {
              freshPriceSol = parseFloat(bestPair.priceNative);
            }
          }
        }
      } catch (e) {
        // Fallback to currentPrice
      }

      const effectivePrice = freshPriceSol || currentPrice || 0.000001;
      const tokensQty = amountSol / effectivePrice;
      const newTrade: SniperTrade = {
        id: this.generateId('simreal-buy'),
        type: 'BUY',
        token: symbol,
        address: cleanMint,
        amount: amountSol,
        timestamp: quoteRequestTime,
        signature: 'SIMREAL_BN_' + Math.random().toString(36).substring(2, 11),
        tokenAmount: tokensQty
      };

      const newPosition: SimRealPosition = {
        symbol,
        buyPrice: effectivePrice,
        currentPrice: effectivePrice,
        solSpent: amountSol,
        amount: tokensQty,
        amountLamports: Math.floor(tokensQty * 10 ** decimals),
        decimals,
        entryTime: quoteRequestTime,
        txid: 'simulation-copy',
        simRealBought: true,
        simRealBoughtPriceSol: effectivePrice,
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

      this.addLog(`Simulated buy completed for ${symbol} @ ${effectivePrice} SOL`, 'SUCCESS');
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
    position: SimRealPosition;
    privateKey: string;
    apiKey?: string;
    rpcUrl: string;
    slippage: number;
    tokenMetrics: Record<string, TokenMetric>;
    updateState: (update: {
      balanceOffset: number;
      newTrade: SniperTrade;
      closedPositionId?: string;
    }) => void;
  }): Promise<void> {
    const cleanMint = mint.trim();
    this.validateSellInputs(cleanMint, position, rpcUrl, slippage);

    this.addLog(`Initiating manual SimReal SELL for ${position.symbol}...`, 'INFO');

    const quoteRequestTime = Date.now();
    const isRealMoney = !!privateKey;

    let sellPriceSol = position.currentPrice;
    const existingMetric = tokenMetrics[cleanMint];
    if (existingMetric) {
      sellPriceSol = existingMetric.priceNative ?? sellPriceSol;
    }

    if (isRealMoney) {
      this.addLog(`[REAL SWAP] Executing direct sell via Jupiter on-chain...`, 'INFO');
      try {
        // Use stored decimals to compute correct raw amount; fallback only if amountLamports is missing
        const sellAmountLamports = position.amountLamports ?? Math.floor(position.amount * 10 ** (position.decimals ?? 9));

        const result = await executeJupiterSwap({
          inputMint: cleanMint,
          outputMint: SOL_MINT,
          amount: sellAmountLamports,
          privateKey,
          apiKey,
          jupRpcUrl: rpcUrl,
          slippage
        });

        if (!result.txid) {
          throw new Error("Jupiter swap transaction ID was not returned.");
        }

        const exactSolOutput = result.outputAmount / 10 ** SOL_DECIMALS;
        const newTrade: SniperTrade = {
          id: this.generateId('simreal-sell'),
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
          newTrade,
          closedPositionId: position.txid // Signal to caller that this position is closed
        });

        this.addLog(`Successfully executed real sell for ${position.symbol}: ${result.txid.slice(0, 10)}...`, 'SUCCESS');
      } catch (err: any) {
        this.addLog(`Real swap failed: ${err.message}`, 'ERROR');
        throw err;
      }
    } else {
      // Simulation mode
      const simulatedPayout = position.amount * sellPriceSol;
      const newTrade: SniperTrade = {
        id: this.generateId('simreal-sell'),
        type: 'SELL',
        token: position.symbol,
        address: cleanMint,
        amount: simulatedPayout,
        timestamp: quoteRequestTime,
        signature: 'SIMREAL_SL_' + Math.random().toString(36).substring(2, 11),
        tokenAmount: position.amount
      };

      updateState({
        balanceOffset: simulatedPayout,
        newTrade,
        closedPositionId: position.txid // Signal to caller that this position is closed
      });

      this.addLog(`Simulated sell completed for ${position.symbol} @ ${sellPriceSol} SOL`, 'SUCCESS');
    }
  }
}

export const simRealTradingEngine = SimRealTradingEngine.getInstance();
