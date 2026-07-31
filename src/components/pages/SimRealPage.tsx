import React, { useState, useEffect, useRef } from 'react';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { 
  TrendingUp, 
  Square, 
  Search, 
  Wallet, 
  RefreshCw, 
  AlertTriangle,
  Zap,
  Bookmark,
  Key,
  Eye,
  EyeOff,
  Copy,
  Check
} from 'lucide-react';
import { TokenMetric, SniperTrade } from '../../types';
import { cn, detectTokenStage } from '../../lib/utils';
import { useAppStore } from '../../store/appStore';
import { useBuySignalStore } from '../../store/buySignalStore';
import { useSimulationStore } from '../../store/simulationStore';
import { simRealTradingEngine } from '../../engines/simRealTradingEngine';
import { getSimRealTradeCount } from '../../config/rebuyGuard';
import { getJupiterQuote } from '../../services/jupiterService';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
import { getSolPriceUsd, getDynamicOperationalFeeSol, calculateSimRealPnl } from '../../utils/pnlCalculator';

interface Position {
  symbol: string;
  buyPrice: number;
  currentPrice: number;
  solSpent: number;
  amount: number;
  amountLamports?: number;
  entryTime: number;
  txid: string;
  recoveryMode?: boolean;
  triggersDisabled?: boolean;
  isScalp?: boolean;
  isStale?: boolean;
  realNetPnl?: number;
  realNetSol?: number;
  simRealBought?: boolean;
  simRealBoughtPriceSol?: number;
  simRealAmountTokens?: number;
  simRealSolSpent?: number;
  simRealBoughtTime?: number;
  simRealIsVirtualFallback?: boolean;
}

interface SimRealPageProps {
  tokenMetrics: Record<string, TokenMetric>;
  positions: Record<string, Position>;
  simRealBalance: number;
  simRealTrades: SniperTrade[];
  maxPositions: number;
  tradePumpFun?: boolean;
  tradeRaydium?: boolean;
  tradeBonding?: boolean;
  tradeUnknown?: boolean;
  simRealTakeProfitRaydium: number;
  setSimRealTakeProfitRaydium: (v: number) => void;
  simRealTakeProfitBonding: number;
  setSimRealTakeProfitBonding: (v: number) => void;
  simRealTakeProfitPumpSwap?: number;
  setSimRealTakeProfitPumpSwap?: (v: number) => void;
  simRealTakeProfitUnknown?: number;
  setSimRealTakeProfitUnknown?: (v: number) => void;
  simRealStopLossRaydium: number;
  setSimRealStopLossRaydium: (v: number) => void;
  simRealStopLossBonding: number;
  setSimRealStopLossBonding: (v: number) => void;
  simRealStopLossPumpSwap: number;
  setSimRealStopLossPumpSwap: (v: number) => void;
  simRealStopLossUnknown: number;
  setSimRealStopLossUnknown: (v: number) => void;
  slippage: number;
  privateKey: string;
  setPrivateKey: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  jupiterRpcUrl?: string;
  setJupiterRpcUrl?: (v: string) => void;
  rpcUrl?: string;
  customWsUrl?: string;
  stopLoss: number;
  bondingCurveStopLoss: number;
  pumpSwapStopLoss: number;
  unknownStopLoss: number;
  executeSimRealSell?: (mint: string) => Promise<void>;
  executeSimRealBuy?: (mint: string, amount: number) => Promise<void>;
  resetSimRealWallet?: () => void;
  simrealControlRef?: React.MutableRefObject<any>;
  maxRebuyTimes: number;
  setMaxRebuyTimes: (v: number) => void;
  jupiterLogs: { id: string; timestamp: number; type: 'QUOTE' | 'SWAP' | 'ERROR' | 'INFO'; message: string; details?: any }[];
  setPositions?: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}

export const SimRealPage: React.FC<SimRealPageProps> = ({
  tokenMetrics,
  positions,
  simRealBalance,
  simRealTrades,
  maxPositions,
  tradePumpFun = true,
  tradeRaydium = true,
  tradeBonding = true,
  tradeUnknown = true,
  simRealTakeProfitRaydium,
  setSimRealTakeProfitRaydium,
  simRealTakeProfitBonding,
  setSimRealTakeProfitBonding,
  simRealTakeProfitPumpSwap,
  setSimRealTakeProfitPumpSwap,
  simRealTakeProfitUnknown,
  setSimRealTakeProfitUnknown,
  simRealStopLossRaydium,
  setSimRealStopLossRaydium,
  simRealStopLossBonding,
  setSimRealStopLossBonding,
  simRealStopLossPumpSwap,
  setSimRealStopLossPumpSwap,
  simRealStopLossUnknown,
  setSimRealStopLossUnknown,
  slippage,
  privateKey,
  setPrivateKey,
  apiKey,
  setApiKey,
  jupiterRpcUrl = '',
  setJupiterRpcUrl = () => {},
  rpcUrl,
  customWsUrl,
  stopLoss,
  bondingCurveStopLoss,
  pumpSwapStopLoss,
  unknownStopLoss,
  executeSimRealSell,
  executeSimRealBuy,
  resetSimRealWallet,
  simrealControlRef,
  maxRebuyTimes,
  setMaxRebuyTimes,
  jupiterLogs,
  setPositions
}) => {
  const [showKey, setShowKey] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ── SERVER HEALTH MONITORING ──
  const [serverHealth, setServerHealth] = useState<'unknown' | 'ok' | 'degraded'>('unknown');
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) {
          const text = await res.text();
          let errStr = `HTTP ${res.status}`;
          try {
            const parsed = JSON.parse(text);
            errStr = parsed.error || parsed.message || errStr;
          } catch {}
          if (active) {
            setServerHealth('degraded');
            setHealthError(errStr);
          }
          return;
        }
        const data = await res.json();
        if (active) {
          setServerHealth(data.status === 'healthy' ? 'ok' : 'degraded');
          if (data.status !== 'healthy') {
            const degradedDetails = Object.entries(data.checks || {})
              .filter(([, v]) => v !== 'OK')
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
            setHealthError(degradedDetails || 'Some dependencies are degraded');
          } else {
            setHealthError(null);
          }
        }
      } catch (err: any) {
        if (active) {
          setServerHealth('degraded');
          setHealthError(err?.message || 'Server check failed');
        }
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── ZUSTAND BUY SIGNALS PIPELINE STORE CONNECTION ──
  const signals = useBuySignalStore(state => state.signals);
  const stats = useBuySignalStore(state => state.stats);
  const claimNextPending = useBuySignalStore(state => state.claimNextPending);
  const markExecuting = useBuySignalStore(state => state.markExecuting);
  const markExecuted = useBuySignalStore(state => state.markExecuted);
  const markFailed = useBuySignalStore(state => state.markFailed);
  const markRejected = useBuySignalStore(state => state.markRejected);
  const pruneOld = useBuySignalStore(state => state.pruneOld);
  const clearSignals = useBuySignalStore(state => state.clearSignals);

  // Lock to prevent concurrent processing of different signals
  const processingLock = useRef(false);
  const simRealBoughtPending = useRef<Set<string>>(new Set());
  const activeSimRealMintsRef = useRef<Set<string>>(new Set());

  // ── RECEIVE TOKEN ADDRESS ONLY & START SIMREAL TRADE ──
  const startNewSimRealTrade = async (tokenAddress: string) => {
    if (!tokenAddress) return;
    const mint = tokenAddress.trim();
    if (!mint) return;

    // Prevent duplicate starts
    if (activeSimRealMintsRef.current.has(mint)) {
      return;
    }
    activeSimRealMintsRef.current.add(mint);

    try {
      // Check if already holding active SimReal position
      if (positions && positions[mint]?.simRealBought) {
        console.log(`[SimReal] Already holding active position for ${mint}`);
        return;
      }

      const storeState = useAppStore.getState();
      const buyAmt = storeState.buyAmountSol || 0.1;

      // Check wallet balance
      if (storeState.simRealBalance < buyAmt) {
        console.warn(`[SimReal] Insufficient SimReal balance (${storeState.simRealBalance.toFixed(4)} SOL < ${buyAmt} SOL)`);
        return;
      }

      // Check max concurrent positions
      const activePositionsCount = Object.values(positions || {}).filter(p => p && p.simRealBought).length;
      if (maxPositions && activePositionsCount >= maxPositions) {
        console.warn(`[SimReal] Max concurrent positions reached (${activePositionsCount}/${maxPositions})`);
        return;
      }

      // Check rebuy limit
      const activeMaxRebuyTimes = maxRebuyTimes !== undefined ? maxRebuyTimes : 1;
      const existingSym = positions?.[mint]?.symbol || storeState.tokenMetrics[mint]?.symbol || 'UNKNOWN';
      const totalSimRealTradedCount = getSimRealTradeCount(
        mint,
        existingSym,
        storeState.simRealTrades,
        positions || {},
        simRealBoughtPending.current
      );
      if (totalSimRealTradedCount >= activeMaxRebuyTimes) {
        console.warn(`[SimReal] Rebuy limit reached for ${mint}`);
        return;
      }

      simRealBoughtPending.current.add(mint.toLowerCase());

      // Independently request current fresh token data and price quote
      let freshPriceUsd = 0;
      let freshPriceNative = 0;
      let symbol = existingSym;
      let freshLiquidityUsd = 50000;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(`/api/dex/tokens/${mint}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          const pair = data?.pairs && Array.isArray(data.pairs) && data.pairs.length > 0
            ? [...data.pairs].sort((a: any, b: any) => (parseFloat(b.liquidity?.usd || '0') - parseFloat(a.liquidity?.usd || '0')))[0]
            : null;
          if (pair) {
            freshPriceUsd = parseFloat(pair.priceUsd || '0') || 0;
            freshPriceNative = parseFloat(pair.priceNative || '0') || 0;
            symbol = pair.baseToken?.symbol || symbol;
            freshLiquidityUsd = parseFloat(pair.liquidity?.usd || '0') || freshLiquidityUsd;
          }
        }
      } catch (err) {
        console.warn('[SimReal] Quote fetch error:', err);
      }

      if (!freshPriceNative && storeState.tokenMetrics[mint]?.priceNative) {
        freshPriceNative = storeState.tokenMetrics[mint].priceNative;
      }
      const finalPriceSol = freshPriceNative > 0 ? freshPriceNative : (freshPriceUsd > 0 ? freshPriceUsd / getSolPriceUsd() : 0.000001);

      // Seed storeState.tokenMetrics
      const formattedMetric: TokenMetric = {
        address: mint,
        symbol: symbol || 'UNKNOWN',
        priceUsd: freshPriceUsd || finalPriceSol * getSolPriceUsd(),
        priceNative: finalPriceSol,
        marketCap: 0,
        liquidity: freshLiquidityUsd,
        volume24h: 100000,
        discoveredAt: Date.now(),
        lastUpdated: Date.now(),
        buyCount: 0,
        sellCount: 0,
        buyVolume: 0,
        sellVolume: 0,
        priceChange5m: 1.0,
        priceChange1m: 0,
        percentageIncrease: 1.0,
        recentBuysTimeline: [],
        category: mint.toLowerCase().endsWith('pump') ? 'PUMP_FUN' : 'RAYDIUM',
        isRugSafe: true,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityBurned: true,
        top10Percentage: 8.5
      };
      storeState.setTokenMetrics(prev => ({ ...prev, [mint]: formattedMetric }));

      // Execute buy
      if (executeSimRealBuy) {
        await executeSimRealBuy(mint, buyAmt);
      } else {
        await simRealTradingEngine.executeBuy({
          mint,
          amountSol: buyAmt,
          privateKey,
          apiKey,
          rpcUrl: rpcUrl || 'https://api.mainnet-beta.solana.com',
          slippage: slippage || 100,
          tokenMetrics: { ...tokenMetrics, [mint]: formattedMetric },
          updateState: (update) => {
            const newPos = update.newPosition;
            if (setPositions) {
              setPositions((prev: any) => ({ ...prev, [mint]: newPos }));
            }
            if (privateKey) {
              useAppStore.getState().updateActivePositions(prev => ({ ...prev, [mint]: newPos }));
            }
          }
        });
      }

      console.log(`[SimReal] Trade successfully started for ${symbol} (${mint}) with amount ${buyAmt} SOL`);
    } catch (error) {
      simRealBoughtPending.current.delete(mint.toLowerCase());
      console.error(`[SimReal] Failed to start trade for ${mint}`, error);
    } finally {
      activeSimRealMintsRef.current.delete(mint);
    }
  };

  useEffect(() => {
    if (simrealControlRef) {
      simrealControlRef.current = {
        ...(simrealControlRef.current || {}),
        receiveTokenAddress: (tokenAddress: string) => {
          startNewSimRealTrade(tokenAddress);
        }
      };
    }
  }, [simrealControlRef]);

  // Manual independent trading states
  const [manualMint, setManualMint] = useState('');
  const [manualAmount, setManualAmount] = useState('0.1');
  const [isBuying, setIsBuying] = useState(false);
  const [buyStatus, setBuyStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const handleManualBuy = async (e: React.FormEvent) => {
    e.preventDefault();
    setBuyStatus(null);
    const mint = manualMint.trim();
    const amount = parseFloat(manualAmount);

    if (!mint) {
      setBuyStatus({ type: 'error', text: 'Token address is required.' });
      return;
    }
    try {
      new PublicKey(mint);
    } catch {
      setBuyStatus({ type: 'error', text: 'Invalid Solana address format.' });
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      setBuyStatus({ type: 'error', text: 'Invalid SOL amount.' });
      return;
    }
    if (simRealBalance < amount) {
      setBuyStatus({ type: 'error', text: `Insufficient SimReal Balance (${simRealBalance.toFixed(4)} SOL).` });
      return;
    }
    if (privateKey && jupiterBalance !== null) {
      const opFeeBuffer = getDynamicOperationalFeeSol(false, amount);
      if (jupiterBalance < amount + opFeeBuffer) {
        setBuyStatus({ type: 'error', text: `Insufficient on-chain wallet balance (${jupiterBalance.toFixed(4)} SOL available).` });
        return;
      }
    }

    // DEX Platform Sources validation (PnLPage synced)
    const manualMetric = tokenMetrics[mint];
    const manualStage = detectTokenStage({
      address: mint,
      dexId: manualMetric?.dexId,
      bondingCurveProgress: manualMetric?.bondingCurveProgress,
      isRaydiumListed: manualMetric?.isRaydiumListed
    });

    if (manualStage.isBonding && !tradeBonding) {
      setBuyStatus({ type: 'error', text: 'Cannot trade: Bonding stage tokens are unselected in DEX Platform Sources on PnLPage.' });
      return;
    }
    if (manualStage.platform === 'PUMP_FUN' && !tradePumpFun) {
      setBuyStatus({ type: 'error', text: 'Cannot trade: Pump.fun tokens are unselected in DEX Platform Sources on PnLPage.' });
      return;
    }
    if (manualStage.platform === 'RAYDIUM' && !tradeRaydium) {
      setBuyStatus({ type: 'error', text: 'Cannot trade: Raydium tokens are unselected in DEX Platform Sources on PnLPage.' });
      return;
    }
    if (manualStage.platform === 'PUMPSWAP' && !tradeRaydium) {
      setBuyStatus({ type: 'error', text: 'Cannot trade: PumpSwap tokens are unselected in DEX Platform Sources on PnLPage.' });
      return;
    }
    if (manualStage.platform === 'UNKNOWN' && !tradeUnknown) {
      setBuyStatus({ type: 'error', text: 'Cannot trade: Unknown tokens are unselected in DEX Platform Sources on PnLPage.' });
      return;
    }

    try {
      setIsBuying(true);
      setBuyStatus({ type: 'info', text: 'Initiating trade swap on-chain/simulation...' });
      
      if (executeSimRealBuy) {
        await executeSimRealBuy(mint, amount);
      } else {
        await simRealTradingEngine.executeBuy({
          mint,
          amountSol: amount,
          privateKey,
          apiKey,
          rpcUrl: rpcUrl || 'https://api.mainnet-beta.solana.com',
          slippage: slippage || 100,
          tokenMetrics,
          updateState: (update) => {
            const newPos = update.newPosition;
            if (setPositions) {
              setPositions((prev: any) => ({ ...prev, [mint]: newPos }));
            }
            if (privateKey) {
              useAppStore.getState().updateActivePositions(prev => ({ ...prev, [mint]: newPos }));
            }
          }
        });
      }

      // Ensure active position state is synchronized
      const storeActiveManual = useAppStore.getState().activePositions[mint] || (positions && positions[mint]);
      if (storeActiveManual) {
        const confirmedPos = {
          ...storeActiveManual,
          simRealBought: true,
          simRealBoughtTime: storeActiveManual.simRealBoughtTime || Date.now()
        };
        if (setPositions) setPositions((prev: any) => ({ ...prev, [mint]: confirmedPos }));
        if (privateKey) {
          useAppStore.getState().updateActivePositions(prev => ({ ...prev, [mint]: confirmedPos }));
        }
      }

      setBuyStatus({ type: 'success', text: `Successfully executed independent swap for ${mint.slice(0, 8)}!` });
      setManualMint(''); // clear input on success
    } catch (err: any) {
      setBuyStatus({ type: 'error', text: err?.message || 'Trade failed.' });
    } finally {
      setIsBuying(false);
    }
  };

  const handleForceSell = async (mint: string) => {
    const pos = positions[mint];
    activeSimRealMintsRef.current.delete(mint);
    if (!pos) return;

    try {
      if (executeSimRealSell) {
        await executeSimRealSell(mint);
      } else {
        await simRealTradingEngine.executeSell({
          mint,
          position: pos as any,
          privateKey,
          apiKey,
          rpcUrl: rpcUrl || 'https://api.mainnet-beta.solana.com',
          slippage: slippage || 100,
          tokenMetrics,
          updateState: () => {}
        });
      }
    } catch (err: any) {
      console.error("Independent sell failed:", err);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };
  
  // --- JUPITER WALLET STATUS, BALANCE, & MONITOR ---
  const [jupiterStatus, setJupiterStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR'>('DISCONNECTED');
  const [jupiterAddress, setJupiterAddress] = useState<string>('');
  const [jupiterBalance, setJupiterBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!privateKey) {
      setJupiterStatus('DISCONNECTED');
      setJupiterAddress('');
      setJupiterBalance(null);
      return;
    }

    let isMounted = true;
    let currentRequestId = 0; // Fixes race condition on wallet connection checking

    const checkWallet = async () => {
      const requestId = ++currentRequestId;
      try {
        setJupiterStatus('CONNECTING');
        let keypair;
        try {
          keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
        } catch (e) {
          if (!isMounted || requestId !== currentRequestId) return;
          setJupiterStatus('ERROR');
          setJupiterAddress('');
          setJupiterBalance(null);
          return;
        }

        const pubKeyStr = keypair.publicKey.toBase58();
        if (!isMounted || requestId !== currentRequestId) return;
        setJupiterAddress(pubKeyStr);

        const activeRpcUrl = jupiterRpcUrl && jupiterRpcUrl.trim() !== "" ? jupiterRpcUrl.trim() : rpcUrl;
        if (!activeRpcUrl) {
          if (!isMounted || requestId !== currentRequestId) return;
          setJupiterStatus('ERROR');
          return;
        }

        const activeWsUrl = (customWsUrl && customWsUrl.trim() !== "") ? customWsUrl.trim() : activeRpcUrl.replace('https', 'wss').replace('http', 'ws');
        const conn = new Connection(activeRpcUrl, { commitment: 'confirmed', wsEndpoint: activeWsUrl });

        const lamports = await conn.getBalance(keypair.publicKey, 'confirmed');
        if (!isMounted || requestId !== currentRequestId) return;
        
        const solBal = lamports / 1_000_000_000;
        setJupiterBalance(solBal);
        setJupiterStatus('CONNECTED');
        
      } catch (err) {
        if (isMounted && requestId === currentRequestId) {
          setJupiterStatus('ERROR');
        }
      }
    };

    checkWallet();
    const interval = setInterval(checkWallet, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [privateKey, rpcUrl, jupiterRpcUrl, customWsUrl]);
  
  const activeSimrealPositions = Object.values(positions || {}).filter(pos => pos && pos.simRealBought);

  const getCompletedSimRealTrades = () => {
    const completed: Array<{
      id: string;
      mint: string;
      token: string;
      buyTime: number;
      sellTime: number;
      buyAmountSol: number;
      sellAmountSol: number;
      pnlPct: number;
      tokenAmount?: number;
    }> = [];
    
    // simRealTrades has newest first, so we reverse it to process chronologically
    const chronological = [...(simRealTrades || [])].reverse();
    const openBuysByPosId: Record<string, { timestamp: number; amount: number; tokenAmount?: number; positionId?: string }> = {};
    const openBuysByAddress: Record<string, Array<{ timestamp: number; amount: number; tokenAmount?: number; positionId?: string }>> = {};
    
    for (const trade of chronological) {
      if (trade.type === 'BUY') {
        const buyItem = { timestamp: trade.timestamp, amount: trade.amount, tokenAmount: trade.tokenAmount, positionId: trade.positionId };
        if (trade.positionId) {
          openBuysByPosId[trade.positionId] = buyItem;
        }
        if (!openBuysByAddress[trade.address]) openBuysByAddress[trade.address] = [];
        openBuysByAddress[trade.address].push(buyItem);
      } else if (trade.type === 'SELL') {
        let buy = trade.positionId ? openBuysByPosId[trade.positionId] : undefined;
        if (!buy) {
          buy = openBuysByAddress[trade.address]?.shift();
        } else if (openBuysByAddress[trade.address]) {
          const idx = openBuysByAddress[trade.address].findIndex(b => b.positionId === trade.positionId);
          if (idx !== -1) openBuysByAddress[trade.address].splice(idx, 1);
        }

        if (buy) {
          completed.push({
            id: trade.id,
            mint: trade.address,
            token: trade.token,
            buyTime: buy.timestamp,
            sellTime: trade.timestamp,
            buyAmountSol: buy.amount,
            sellAmountSol: trade.amount,
            pnlPct: buy.amount > 0 ? ((trade.amount - buy.amount) / buy.amount) * 100 : (trade.pnl ?? 0),
            tokenAmount: buy.tokenAmount || trade.tokenAmount
          });
        } else {
          const derivedBuySol = (trade.pnl !== undefined && trade.amount > 0 && trade.pnl > -100)
            ? trade.amount / (1 + trade.pnl / 100)
            : 0;
          completed.push({
            id: trade.id,
            mint: trade.address,
            token: trade.token,
            buyTime: 0, // 0 indicates UNMATCHED
            sellTime: trade.timestamp,
            buyAmountSol: derivedBuySol,
            sellAmountSol: trade.amount,
            pnlPct: trade.pnl !== undefined ? trade.pnl : 0,
            tokenAmount: trade.tokenAmount
          });
        }
      }
    }
    
    return completed.reverse();
  };

  // ── BACKGROUND WORKER: Buy Signal Pipeline ──
  useEffect(() => {
    let workerActive = true;

    const processSignalQueue = async () => {
      // 1. Check lock
      if (processingLock.current || !workerActive) return;

      // ── INTERNET DISCONNECT GUARD ──
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        console.warn('[Pipeline] Internet offline. Pausing signal processing queue.');
        return;
      }

      // ── SERVER HEALTH CHECK GATE ──
      if (serverHealth === 'degraded' && privateKey) {
        return;
      }

      processingLock.current = true;
      let executingSignalId: string | null = null;
      let currentTokenAddress = '';

      try {
        // 2. Claim next pending signal
        const signal = claimNextPending();
        if (!signal) {
          return;
        }
        
        executingSignalId = signal.id;

        const { tokenAddress } = signal;
        currentTokenAddress = tokenAddress;

        if (!tokenAddress) {
          markRejected(signal.id, 'No token address in signal');
          return;
        }

        console.log(`[Pipeline] Processing signal address ONLY: ${tokenAddress}`);
        markExecuting(signal.id);
        await startNewSimRealTrade(tokenAddress);
        markExecuted(signal.id, `tx-simreal-${Date.now()}`);
        return;


      } catch (err: any) {
        console.error(`[Pipeline Error] Signal swap execution failed:`, err);
        if (executingSignalId) {
          markFailed(executingSignalId, err?.message || 'Transaction execution failed');
        }
      } finally {
        if (currentTokenAddress) {
          simRealBoughtPending.current.delete(currentTokenAddress.toLowerCase().trim());
        }
        processingLock.current = false;
      }
    };

    // Run immediate check when pending signals exist or on fast interval
    if (signals.some(s => s.status === 'pending') && !processingLock.current) {
      processSignalQueue();
    }

    const intervalId = setInterval(() => {
      if (useBuySignalStore.getState().signals.some(s => s.status === 'pending') && !processingLock.current) {
        processSignalQueue();
      }
    }, 500);

    // Prune old signals every 30 seconds
    const pruneId = setInterval(() => {
      pruneOld(5 * 60 * 1000); // 5-minute deduplication window
    }, 30000);

    return () => {
      workerActive = false;
      clearInterval(intervalId);
      clearInterval(pruneId);
    };
  }, [
    positions,
    maxRebuyTimes,
    maxPositions,
    tradePumpFun,
    tradeRaydium,
    tradeBonding,
    tradeUnknown,
    privateKey,
    jupiterBalance,
    serverHealth,
    apiKey,
    jupiterRpcUrl,
    rpcUrl,
    slippage,
    tokenMetrics,
    setPositions,
    claimNextPending,
    markExecuting,
    markExecuted,
    markFailed,
    markRejected,
    pruneOld,
    executeSimRealBuy
  ]);

  // Fixes Incorrect Dependency Array for TP/SL Monitor Worker
  const positionsRef = useRef(positions);
  const tokenMetricsRef = useRef(tokenMetrics);
  
  useEffect(() => {
    positionsRef.current = positions;
    tokenMetricsRef.current = tokenMetrics;
  }, [positions, tokenMetrics]);

  const sellingMints = useRef<Set<string>>(new Set());

  // ── BACKGROUND WORKER: SimReal Active Positions TP/SL Monitor ──
  useEffect(() => {
    let active = true;

    const monitorPositions = async () => {
      if (!active) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      
      const currentPositions = positionsRef.current;
      const currentTokenMetrics = tokenMetricsRef.current;
      
      for (const [mint, pos] of Object.entries(currentPositions || {})) {
         if (!pos || !pos.simRealBought) continue;
         if (sellingMints.current.has(mint)) continue;
         
         const tokenMetric = currentTokenMetrics[mint];
         const stageInfo = tokenMetric ? detectTokenStage(tokenMetric) : { stage: 'UNKNOWN', platform: 'UNKNOWN', isBonding: false, isMigrated: false, isNewListing: false, isNearMigration: false, bondingProgress: 0 } as const;
         
         const userSL = Math.abs(stopLoss !== undefined ? stopLoss : 15);
         let tpLimit = 0.50; // default 50%
         let slLimit = -userSL / 100; // default to user's stop loss
         
         if (stageInfo.platform === 'RAYDIUM' || stageInfo.isMigrated) {
             tpLimit = Math.abs(simRealTakeProfitRaydium !== undefined ? simRealTakeProfitRaydium : 50) / 100;
             slLimit = -Math.abs(simRealStopLossRaydium !== undefined ? simRealStopLossRaydium : userSL) / 100;
         } else if (stageInfo.platform === 'PUMP_FUN' || stageInfo.isBonding || mint.toLowerCase().endsWith('pump')) {
             tpLimit = Math.abs(simRealTakeProfitBonding !== undefined ? simRealTakeProfitBonding : 100) / 100;
             slLimit = -Math.abs(simRealStopLossBonding !== undefined ? simRealStopLossBonding : userSL) / 100;
         } else if (stageInfo.platform === 'PUMPSWAP') {
             tpLimit = Math.abs(simRealTakeProfitPumpSwap !== undefined ? simRealTakeProfitPumpSwap : (simRealTakeProfitRaydium !== undefined ? simRealTakeProfitRaydium : 50)) / 100;
             slLimit = -Math.abs(simRealStopLossPumpSwap !== undefined ? simRealStopLossPumpSwap : userSL) / 100;
         } else {
             tpLimit = Math.abs(simRealTakeProfitUnknown !== undefined ? simRealTakeProfitUnknown : (simRealTakeProfitRaydium !== undefined ? simRealTakeProfitRaydium : 50)) / 100;
             slLimit = -Math.abs(simRealStopLossUnknown !== undefined ? simRealStopLossUnknown : userSL) / 100;
         }

         const spentSol = pos.simRealSolSpent || pos.solSpent || 0;
         const tokensQty = (pos.simRealAmountTokens && pos.simRealAmountTokens > 0)
           ? pos.simRealAmountTokens
           : (pos.amount && pos.amount > 0)
           ? pos.amount
           : 0;
         const boughtPrice = pos.simRealBoughtPriceSol || pos.buyPrice || (tokensQty > 0 ? spentSol / tokensQty : 0);

         if (!spentSol || spentSol <= 0 || !tokensQty || tokensQty <= 0 || !boughtPrice || boughtPrice <= 0) {
           console.warn(`[SimReal monitorPositions] Skipping exit check for ${mint.slice(0, 8)} due to missing/invalid position data (spentSol=${spentSol}, tokensQty=${tokensQty}, boughtPrice=${boughtPrice}). Refusing to auto-sell on bad data.`);
           continue;
         }

         let metricPriceSol = 0;
         if (tokenMetric?.priceNative && tokenMetric.priceNative > 0) {
           metricPriceSol = parseFloat(String(tokenMetric.priceNative));
         } else if (tokenMetric?.priceUsd && tokenMetric.priceUsd > 0) {
           metricPriceSol = parseFloat(String(tokenMetric.priceUsd)) / getSolPriceUsd();
         }

         const currPrice = metricPriceSol > 0 ? metricPriceSol : (pos.currentPrice || boughtPrice);
         
         let simRealNetPnlPct = 0;
         let simRealGrossPnlPct = 0;
         
         // If it's a real money position, we MUST check actual executable Jupiter quote
         if (privateKey && pos.simRealAmountTokens && pos.simRealAmountTokens > 0 && !pos.simRealIsVirtualFallback) {
             try {
                // Determine token lamports dynamically since it's not strongly stored
                // We'll estimate based on decimals, or just use the amount directly if it's already in lamports
                const decimals = pos.amountLamports ? Math.round(Math.log10(pos.amountLamports / pos.simRealAmountTokens)) : 6;
                const lamportsToSell = pos.amountLamports || Math.floor(pos.simRealAmountTokens * (10 ** decimals));
                
                if (lamportsToSell > 0) {
                   const quote = await getJupiterQuote(mint, SOL_MINT, lamportsToSell, tokenMetric?.liquidity || 0);
                   if (quote && quote.outAmount) {
                      const expectedSolOut = Number(quote.outAmount) / 1_000_000_000.0;
                      const operationalFeesSol = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol);
                      const netSolReturn = Math.max(0, expectedSolOut - operationalFeesSol);
                      simRealNetPnlPct = (netSolReturn - spentSol) / spentSol;
                      simRealGrossPnlPct = (expectedSolOut - spentSol) / spentSol;
                   }
                }
             } catch (e) {
                console.warn(`[SimReal TP/SL] Quote error for real position ${pos.symbol || mint}:`, e);
             }

             if (simRealNetPnlPct === 0 && simRealGrossPnlPct === 0) {
                console.warn(`[SimReal TP/SL] Executable quote unavailable for real position ${pos.symbol || mint}. Holding position.`);
                continue;
             }
         } else {
             // Simulation fallback
             const pnlRes = calculateSimRealPnl(spentSol, tokensQty, boughtPrice, currPrice, slippage, pos.recoveryMode, false);
             if (pnlRes) {
               simRealNetPnlPct = pnlRes.netPnlPct / 100;
               simRealGrossPnlPct = pnlRes.grossPnlPct / 100;
             }
         }

         // Immediate sell trigger when token PnL profit goes higher or reaches take-profit target / stop loss
         if (simRealNetPnlPct >= tpLimit || simRealNetPnlPct <= slLimit) {
            console.log(`[SimReal TP/SL] Immediate sell triggered for ${pos.symbol || mint} at gross ${(simRealGrossPnlPct * 100).toFixed(2)}% / net ${(simRealNetPnlPct * 100).toFixed(2)}% PnL (TP limit: ${(tpLimit * 100).toFixed(1)}%)`);
            
            sellingMints.current.add(mint);
            try {
               await executeSimRealSell(mint);
            } catch (e) {
               console.error(`Failed to auto-sell SimReal position for ${mint}:`, e);
            } finally {
               sellingMints.current.delete(mint);
            }
         }
      }
    };

    let monitoring = false;
    let timerId: ReturnType<typeof setTimeout>;

    const monitorLoop = async () => {
      if (!active) return;
      if (monitoring) return;

      monitoring = true;
      try {
        await monitorPositions();
      } finally {
        monitoring = false;
      }
      
      if (active) {
        timerId = setTimeout(monitorLoop, 300);
      }
    };

    // Run monitor check immediately and start loop
    monitorLoop();

    return () => {
      active = false;
      clearTimeout(timerId);
    };
  }, [
    positions,
    tokenMetrics,
    simRealTakeProfitRaydium, 
    simRealTakeProfitBonding, 
    simRealTakeProfitPumpSwap,
    simRealTakeProfitUnknown,
    simRealStopLossRaydium, 
    simRealStopLossBonding, 
    simRealStopLossPumpSwap, 
    simRealStopLossUnknown, 
    privateKey, 
    slippage, 
    executeSimRealSell
  ]);

  const completedTrades = getCompletedSimRealTrades();

  const totalBuySol = completedTrades.reduce((sum, t) => sum + t.buyAmountSol, 0);
  const totalSellSol = completedTrades.reduce((sum, t) => sum + t.sellAmountSol, 0);
  const totalProfitSol = totalSellSol - totalBuySol;
  const totalPnlPct = totalBuySol > 0 ? (totalProfitSol / totalBuySol) * 100 : 0;

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6 lg:space-y-12 w-full h-full overflow-y-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-[#1f212e]">
        <div>
          <h1 className="text-2xl lg:text-3xl font-black uppercase tracking-wider text-emerald-400 flex items-center gap-3">
            <Wallet className="w-8 h-8 text-emerald-400" />
            Simreal Trading Platform
          </h1>
          <p className="text-xs uppercase tracking-widest font-mono text-slate-500 mt-1">
            Simulated Real-Time Copy Trader and Automated Active Wallet Execution
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`w-2 h-2 rounded-full inline-block ${
              serverHealth === 'ok' ? 'bg-emerald-400 animate-pulse' :
              serverHealth === 'degraded' ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'
            }`} />
            <span className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400 flex items-center gap-1.5">
              Server status: <span className={
                serverHealth === 'ok' ? 'text-emerald-400' :
                serverHealth === 'degraded' ? 'text-amber-400' : 'text-slate-500'
              }>{serverHealth === 'ok' ? 'ONLINE' : serverHealth === 'degraded' ? 'DEGRADED' : 'CHECKING...'}</span>
            </span>
            {healthError && (
              <span className="text-[9px] text-amber-500 font-mono">({healthError})</span>
            )}
          </div>
        </div>
        
        <div className="bg-[#10111a]/60 border border-[#1f212e] rounded-xl px-4 py-3 flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-500 uppercase tracking-widest font-mono">Simreal Wallet Balance</span>
            <span className="text-lg font-mono font-black text-emerald-400">
              {simRealBalance.toFixed(4)} SOL
            </span>
          </div>
          <button 
            onClick={async () => {
              if (resetSimRealWallet) await resetSimRealWallet();
              useSimulationStore.setState({ positions: {}, closedPositions: [] });
              useBuySignalStore.getState().clearSignals();
              useBuySignalStore.getState().resetSignals();
              useAppStore.getState().setTokenMetrics(() => ({}));
              useAppStore.getState().updateActivePositions(() => ({}));
              if (setPositions) setPositions({});
              positionsRef.current = {};
            }}
            className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-emerald-500/20 transition-all active:scale-95 flex items-center gap-1.5"
            title="Reset wallet balance, trades, simulation positions, and clear Buy Signals Pipeline & token caches"
          >
            <RefreshCw className="w-3 h-3" />
            Reset
          </button>
        </div>
      </header>

      {!isOnline && (
        <div id="simreal-offline-banner" className="bg-red-500/15 border border-red-500/40 rounded-xl p-4 text-red-400 text-xs font-mono flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-red-400" />
          <div>
            <span className="font-bold uppercase tracking-wider block">Internet Connection Offline</span>
            <span>Trading pipeline, signal processing, and auto-entry/exit are safely paused to prevent executing simulation tokens while disconnected.</span>
          </div>
        </div>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Active Positions */}
        <div className="lg:col-span-5 space-y-4">
          {/* Credentials Configuration Card */}
          <div className="bg-[#10111a]/60 border border-[#1f212e] rounded-2xl flex flex-col p-4 space-y-3">
             <div className="flex flex-col pb-2 border-b border-[#1f212e]">
                <h2 className="text-[12px] uppercase tracking-[1px] text-emerald-400 font-bold flex items-center gap-2">
                   <Key className="w-3.5 h-3.5" />
                   On-Chain Credentials & Limits
                </h2>
                <span className="text-[9px] text-slate-500 uppercase font-mono mt-0.5">Sensitive keys & buy limits used strictly for SimReal active positions</span>
             </div>
             
             <div className="space-y-3">
                <div className="flex flex-col gap-1">
                   <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Jupiter API Key</label>
                   <input
                      type="text"
                      placeholder="Optional. Jupiter premium API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                   />
                </div>

                <div className="flex flex-col gap-1">
                   <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                      <span>Jupiter Custom RPC URL</span>
                      <span className="text-[8px] text-emerald-400 font-normal normal-case">(Fixes Swap Failures)</span>
                   </label>
                   <input
                      type="text"
                      placeholder="Optional. Dedicated RPC for Jupiter swap transactions"
                      value={jupiterRpcUrl}
                      onChange={(e) => setJupiterRpcUrl(e.target.value)}
                      className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                   />
                </div>
                
                <div className="flex flex-col gap-1">
                   <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Wallet Private Key (Base58)</label>
                   <div className="relative">
                      <input
                         type={showKey ? "text" : "password"}
                         placeholder="Optional. Paste your Base58 Private Key to enable real swaps"
                         value={privateKey}
                         onChange={(e) => setPrivateKey(e.target.value)}
                         className="bg-[#07080e] border border-[#1f212e] rounded-lg pl-3 pr-10 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                      />
                      <button
                         type="button"
                         onClick={() => setShowKey(!showKey)}
                         className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                      >
                         {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                   </div>
                </div>

                <div className="flex flex-col gap-1">
                   <div className="flex justify-between items-center">
                      <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Max Rebuy Times</label>
                      <span className="text-[9px] text-slate-500 font-mono">Max trades per token</span>
                   </div>
                   <input
                      type="number"
                      min="1"
                      step="1"
                      value={maxRebuyTimes}
                      onChange={(e) => setMaxRebuyTimes(Number(e.target.value))}
                      className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                   />
                </div>

                {/* Active DEX Platform Sources Indicator (Synced from PnLPage) */}
                <div className="flex flex-col gap-1.5 p-2.5 bg-[#07080e] border border-[#1f212e] rounded-xl">
                   <div className="flex justify-between items-center text-[10px] font-mono uppercase text-slate-400">
                      <span>DEX Platform Sources (PnLPage Synced)</span>
                   </div>
                   <div className="grid grid-cols-2 gap-1.5 text-[9px] font-mono">
                      <div className={`px-2 py-1 rounded border flex items-center justify-between ${tradePumpFun ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-800/50 text-slate-500 border-slate-700/50'}`}>
                         <span>PUMP.FUN</span>
                         <span className="font-bold">{tradePumpFun ? 'ACTIVE' : 'OFF'}</span>
                      </div>
                      <div className={`px-2 py-1 rounded border flex items-center justify-between ${tradeRaydium ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-800/50 text-slate-500 border-slate-700/50'}`}>
                         <span>RAYDIUM</span>
                         <span className="font-bold">{tradeRaydium ? 'ACTIVE' : 'OFF'}</span>
                      </div>
                      <div className={`px-2 py-1 rounded border flex items-center justify-between ${tradeBonding ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-800/50 text-slate-500 border-slate-700/50'}`}>
                         <span>BONDING</span>
                         <span className="font-bold">{tradeBonding ? 'ACTIVE' : 'OFF'}</span>
                      </div>
                      <div className={`px-2 py-1 rounded border flex items-center justify-between ${tradeUnknown ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-800/50 text-slate-500 border-slate-700/50'}`}>
                         <span>UNKNOWN</span>
                         <span className="font-bold">{tradeUnknown ? 'ACTIVE' : 'OFF'}</span>
                      </div>
                   </div>
                </div>
                {privateKey ? (
                   <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-2">
                      <div className="flex items-center gap-2">
                         <div className={`w-1.5 h-1.5 rounded-full ${
                            jupiterStatus === 'CONNECTED' ? 'bg-emerald-400 animate-pulse' :
                            jupiterStatus === 'CONNECTING' ? 'bg-amber-400 animate-pulse' :
                            'bg-rose-400'
                         }`} />
                         <span className="text-[10px] text-emerald-400 font-mono uppercase font-bold">Jupiter Wallet: {jupiterStatus}</span>
                      </div>
                      {jupiterAddress && (
                         <div className="flex justify-between items-center text-[9px] font-mono text-slate-400 pt-1 border-t border-[#1f212e]/50">
                            <span>ADDRESS:</span>
                            <span className="text-slate-200 font-bold">{jupiterAddress.slice(0, 8)}...{jupiterAddress.slice(-8)}</span>
                         </div>
                      )}
                      {jupiterBalance !== null && (
                         <div className="space-y-1">
                            <div className="flex justify-between items-center text-[9px] font-mono text-slate-400">
                               <span>ON-CHAIN BALANCE:</span>
                               <span className="text-[#c7f284] font-black">{jupiterBalance.toFixed(4)} SOL</span>
                            </div>
                            {jupiterBalance === 0 && (
                               <div className="text-[9px] text-amber-400 font-mono flex flex-col gap-1 bg-amber-400/10 px-2 py-1.5 rounded mt-1 border border-amber-400/20">
                                  <div className="font-bold flex items-center gap-1 text-amber-300">
                                     <span>⚠️ TRADING SIMULATION ACTIVE</span>
                                  </div>
                                  <div className="text-[8px] text-slate-300 leading-normal">
                                     On-chain balance is 0.0000 SOL. Reverting to virtual simulation balance ({simRealBalance.toFixed(4)} SOL) to resume copy trading safely.
                                  </div>
                               </div>
                            )}
                         </div>
                      )}
                   </div>
                ) : (
                   <div className="p-3 bg-slate-500/5 border border-slate-500/10 rounded-xl flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                      <span className="text-[10px] text-slate-400 font-mono uppercase">Simulation Only (Dry-Run Mode)</span>
                   </div>
                )}
             </div>
          </div>

          {/* Direct Independent Swap Card */}
          <div className="bg-[#10111a]/60 border border-[#1f212e] rounded-2xl flex flex-col p-4 space-y-3">
             <div className="flex flex-col pb-2 border-b border-[#1f212e]">
                <h2 className="text-[12px] uppercase tracking-[1px] text-emerald-400 font-bold flex items-center gap-2">
                   <Zap className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                   Direct Independent Swap (Buy)
                </h2>
                <span className="text-[9px] text-slate-500 uppercase font-mono mt-0.5">Paste any contract to execute manual trades independently</span>
             </div>

             <form onSubmit={handleManualBuy} className="space-y-3">
                <div className="flex flex-col gap-1">
                   <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Token Mint Address</label>
                   <input
                      type="text"
                      placeholder="Paste Solana Token Address (Mint)"
                      value={manualMint}
                      onChange={(e) => setManualMint(e.target.value)}
                      disabled={isBuying}
                      className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                   />
                </div>

                <div className="flex flex-col gap-1">
                   <div className="flex justify-between items-center">
                      <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Buy Amount (SOL)</label>
                      <span className="text-[9px] text-slate-500 font-mono">Current: {simRealBalance.toFixed(4)} SOL available</span>
                   </div>
                   <input
                      type="number"
                      step="0.01"
                      min="0.001"
                      placeholder="0.1"
                      value={manualAmount}
                      onChange={(e) => setManualAmount(e.target.value)}
                      disabled={isBuying}
                      className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                   />
                   
                   {/* Quick Size Selection Buttons */}
                   <div className="grid grid-cols-5 gap-1.5 pt-1">
                      {['0.01', '0.05', '0.1', '0.5', '1.0'].map((val) => (
                         <button
                            key={`quick-size-${val}`}
                            type="button"
                            onClick={() => setManualAmount(val)}
                            disabled={isBuying}
                            className={cn(
                               "text-[9px] font-bold py-1 px-1 text-center rounded transition-all font-mono",
                               manualAmount === val 
                                 ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" 
                                 : "bg-[#07080e] hover:bg-[#10111a] text-slate-400 border border-[#1f212e] hover:text-white"
                            )}
                         >
                            {val}
                         </button>
                      ))}
                   </div>
                </div>

                {buyStatus && (
                   <div className={cn(
                      "p-2.5 rounded-lg text-[10px] font-mono leading-normal border",
                      buyStatus.type === 'error' ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                      buyStatus.type === 'success' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                      "bg-blue-500/10 text-blue-400 border-blue-500/20"
                   )}>
                      {buyStatus.text}
                   </div>
                )}

                <button
                   type="submit"
                   disabled={isBuying}
                   className={cn(
                      "w-full py-2 px-4 rounded-lg font-black uppercase text-[10px] tracking-wider transition-all flex items-center justify-center gap-1.5 active:scale-95 border",
                      isBuying 
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-400 cursor-not-allowed" 
                        : "bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/30 text-emerald-400 hover:text-emerald-300"
                   )}
                >
                   {isBuying ? (
                      <>
                         <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                         Executing Swap...
                      </>
                   ) : (
                      <>
                         <Zap className="w-3.5 h-3.5" />
                         Execute Swap (Buy)
                      </>
                   )}
                </button>
             </form>
          </div>

          <div className="bg-[#10111a]/60 border border-[#1f212e] rounded-2xl flex flex-col p-4">
            <div className="flex justify-between items-center pb-3 border-b border-[#1f212e] mb-4">
              <div className="flex flex-col">
                <h2 className="text-[12px] uppercase tracking-[1px] text-[#c7f284] font-bold">
                  Simreal Active Positions ({activeSimrealPositions.length}/{maxPositions || '♾️'})
                </h2>
                <span className="text-[9px] text-slate-500 uppercase font-mono mt-0.5">Live Copied Positions Currently Held</span>
              </div>
              <span className="text-[10px] font-mono text-[#c7f284] bg-[#c7f284]/10 px-2 py-0.5 rounded border border-[#c7f284]/20 font-bold animate-pulse">
                {activeSimrealPositions.length} Active
              </span>
            </div>
            
            <div className="bg-[#0a0b14] border border-[#1f212e] rounded-xl p-4 mb-4">
               <h3 className="text-[11px] font-mono text-[#94a3b8] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Auto-Sell Limits (SimReal)
               </h3>
                <div className="space-y-3">
                   <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">TP (Raydium)</label>
                            <span className="text-[9px] text-emerald-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealTakeProfitRaydium}
                            onChange={(e) => setSimRealTakeProfitRaydium(Number(e.target.value))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">SL (Raydium)</label>
                            <span className="text-[9px] text-rose-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealStopLossRaydium}
                            onChange={(e) => setSimRealStopLossRaydium(-Math.abs(Number(e.target.value)))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                   </div>
                   
                   <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">TP (Bonding)</label>
                            <span className="text-[9px] text-emerald-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealTakeProfitBonding}
                            onChange={(e) => setSimRealTakeProfitBonding(Number(e.target.value))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">SL (Bonding)</label>
                            <span className="text-[9px] text-rose-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealStopLossBonding}
                            onChange={(e) => setSimRealStopLossBonding(-Math.abs(Number(e.target.value)))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                   </div>

                   <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">TP (PumpSwap)</label>
                            <span className="text-[9px] text-emerald-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealTakeProfitPumpSwap !== undefined ? simRealTakeProfitPumpSwap : simRealTakeProfitRaydium}
                            onChange={(e) => setSimRealTakeProfitPumpSwap && setSimRealTakeProfitPumpSwap(Number(e.target.value))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">SL (PumpSwap)</label>
                            <span className="text-[9px] text-rose-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealStopLossPumpSwap}
                            onChange={(e) => setSimRealStopLossPumpSwap(-Math.abs(Number(e.target.value)))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                   </div>

                   <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">TP (Unknown)</label>
                            <span className="text-[9px] text-emerald-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealTakeProfitUnknown !== undefined ? simRealTakeProfitUnknown : simRealTakeProfitRaydium}
                            onChange={(e) => setSimRealTakeProfitUnknown && setSimRealTakeProfitUnknown(Number(e.target.value))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">SL (Unknown)</label>
                            <span className="text-[9px] text-rose-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealStopLossUnknown}
                            onChange={(e) => setSimRealStopLossUnknown(-Math.abs(Number(e.target.value)))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                   </div>
                </div>

            </div>
            <div className="space-y-3">
              {activeSimrealPositions.length === 0 ? (
                <div className="bg-[#10111a]/40 border border-[#1f212e] border-dashed rounded-2xl p-12 flex flex-col items-center justify-center text-center text-[#64748b]">
                  <div className="w-12 h-12 rounded-full bg-[#1a1b26] border border-[#2d2e3d] flex items-center justify-center mb-3">
                    <Search className="w-5 h-5 text-[#94a3b8] opacity-50" />
                  </div>
                  <p className="text-[13px] text-[#e2e8f0] font-bold">No active Simreal positions.</p>
                  <p className="text-[12px] opacity-70 mt-1 max-w-xs">Copy trades will appear automatically here as system-check and live sniper targets are detected.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {Object.entries(positions || {})
                    .filter(([_, pos]) => pos && pos.simRealBought)
                    .map(([mint, pos]) => {
                      const token = tokenMetrics[mint];
                      let metricPriceSol = 0;
                      if (token?.priceNative && token.priceNative > 0) {
                        metricPriceSol = parseFloat(String(token.priceNative));
                      } else if (token?.priceUsd && token.priceUsd > 0) {
                        metricPriceSol = parseFloat(String(token.priceUsd)) / getSolPriceUsd();
                      }
                      const tokensQty = pos.simRealAmountTokens || 0;
                      const spentSol = pos.simRealSolSpent || 0;
                      const currentPrice = metricPriceSol > 0 ? metricPriceSol : (pos.currentPrice && pos.currentPrice > 0 ? pos.currentPrice : null);
                      const isStalePos = currentPrice === null;
                      const entryPrice = pos.simRealBoughtPriceSol || (tokensQty > 0 && spentSol > 0 ? spentSol / tokensQty : null);
                      
                      let pnlPct: number | null = null;
                      let profitSol = 0;

                      if (privateKey && !pos.simRealIsVirtualFallback && pos.realNetPnl !== undefined && !isNaN(pos.realNetPnl)) {
                         pnlPct = pos.realNetPnl;
                         profitSol = spentSol * pnlPct;
                      } else if (currentPrice !== null && spentSol > 0) {
                         const currentGrossSimReal = currentPrice * tokensQty;
                         let netSimRealIfSold = currentGrossSimReal;
                         if (!privateKey || pos.simRealIsVirtualFallback) {
                            const slippageFee = currentGrossSimReal * (slippage / 100);
                            const opFees = getDynamicOperationalFeeSol(pos.recoveryMode, spentSol);
                            netSimRealIfSold = Math.max(0, currentGrossSimReal - slippageFee - opFees);
                         }
                         pnlPct = (netSimRealIfSold - spentSol) / spentSol;
                         profitSol = netSimRealIfSold - spentSol;
                      }
                      
                      const isPos = (pnlPct ?? 0) >= 0;

                      const stage = detectTokenStage({
                        address: mint,
                        dexId: token?.dexId,
                        bondingCurveProgress: token?.bondingCurveProgress,
                        isRaydiumListed: token?.isRaydiumListed
                      });
                      
                      let activeTP = simRealTakeProfitRaydium;
                      let activeSL = simRealStopLossRaydium;
                      
                      if (stage.platform === 'RAYDIUM' || stage.isMigrated) {
                        activeTP = simRealTakeProfitRaydium;
                        activeSL = simRealStopLossRaydium;
                      } else if (stage.platform === 'PUMP_FUN' || stage.isBonding || mint.toLowerCase().endsWith('pump')) {
                        activeTP = simRealTakeProfitBonding;
                        activeSL = simRealStopLossBonding;
                      } else if (stage.platform === 'PUMPSWAP') {
                        activeTP = simRealTakeProfitPumpSwap !== undefined ? simRealTakeProfitPumpSwap : simRealTakeProfitRaydium; 
                        activeSL = simRealStopLossPumpSwap;
                      } else {
                        activeTP = simRealTakeProfitUnknown !== undefined ? simRealTakeProfitUnknown : simRealTakeProfitRaydium;
                        activeSL = simRealStopLossUnknown;
                      }

                      return (
                        <div key={`simreal-page-${mint}`} className="bg-[#0a0b14] border border-[#1f212e] rounded-xl p-4 grid grid-cols-2 gap-x-2 gap-y-3">
                          <div className="col-span-2 flex items-center gap-2 mb-1 flex-wrap">
                            <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
                              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                            <div className="font-bold text-[14px] text-white flex items-center gap-1.5 flex-wrap">
                              {pos.symbol} <span className="text-[#64748b] text-[12px] font-normal hidden sm:inline">/ SOL</span>
                              
                              {stage.isBonding ? (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30 whitespace-nowrap">
                                  BONDING {stage.bondingProgress.toFixed(0)}%
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 whitespace-nowrap">
                                  {stage.platform}
                                </span>
                              )}

                              <span className="text-emerald-400 text-[9px] whitespace-nowrap bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                TP: {activeTP}%
                              </span>
                              <span className="text-rose-400 text-[9px] whitespace-nowrap bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                                SL: {activeSL}%
                              </span>

                              {stage.isNearMigration && (
                                <span className="text-yellow-400 text-[9px] animate-pulse whitespace-nowrap border border-yellow-400/30 bg-yellow-400/10 px-1.5 py-0.5 rounded">
                                  ⚡ MIGRATING
                                </span>
                              )}
                            </div>
                            
                            <div className="ml-auto text-right font-mono">
                              {pnlPct === null ? (
                                <div className="flex flex-col items-end">
                                  <span className="text-amber-500 font-bold text-[13px] uppercase">N/A</span>
                                  <span className="text-[10px] text-[#64748b]">Fetching Quote</span>
                                </div>
                              ) : (
                                <div className={`text-[14px] font-semibold ${isPos ? 'text-[#c7f284]' : 'text-[#ff4d4d]'}`}>
                                  <div>{isPos ? '+' : ''}{(pnlPct * 100).toFixed(2)}%</div>
                                  <div className="text-[11px] opacity-80">{profitSol >= 0 ? '+' : ''}{profitSol.toFixed(4)} SOL</div>
                                </div>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-[#64748b] text-[11px] mb-1 uppercase font-medium">Entry Price</div>
                            <div className="font-mono text-[14px] font-semibold text-[#e2e8f0]">
                              {entryPrice !== null ? `${entryPrice.toFixed(8)} SOL` : 'N/A'}
                            </div>
                            <div className="text-[10px] text-[#64748b] mt-0.5">
                              {tokensQty.toLocaleString(undefined, { maximumFractionDigits: 4 })} tokens for {spentSol.toFixed(4)} SOL
                            </div>
                          </div>

                          <div>
                            <div className="text-[#64748b] text-[11px] mb-1 uppercase font-medium">Current Price</div>
                            <div className="font-mono text-[14px] font-semibold text-[#e2e8f0]">
                              {currentPrice === null ? (
                                <span className="text-amber-500 font-bold text-[12px]">PRICE UNAVAILABLE</span>
                              ) : (
                                `${currentPrice.toFixed(8)} SOL`
                              )}
                            </div>
                          </div>
                          
                          <div className="col-span-2 pt-2">
                             <button 
                               onClick={() => handleForceSell(mint)}
                               className="w-full bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-rose-500/20 group"
                              >
                               <span className="flex items-center justify-center gap-2">
                                  <Square className="w-3 h-3 group-hover:scale-110 transition-transform" />
                                  Emergency Force Exit
                               </span>
                             </button>
                          </div>
                          
                          <div className="col-span-2 flex justify-between items-center pt-2 border-t border-[#1f212e]/60">
                            <div className="text-[#64748b] text-[10px] uppercase font-bold tracking-wider">
                              Buy: <span className="text-[#e2e8f0] ml-1">{new Date(pos.simRealBoughtTime || pos.entryTime).toLocaleTimeString()}</span>
                            </div>
                            <a 
                              href={`https://dexscreener.com/solana/${mint}`}
                              target="_blank"
                              rel="noopener noreferrer" 
                              className="flex items-center gap-1 text-[10px] font-bold text-[#94a3b8] hover:text-indigo-400 uppercase tracking-wider transition-colors"
                            >
                              DexScreener <Search className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
          
          {/* Jupiter System Logs */}
          <div className="bg-[#10111a]/60 border border-[#1f212e] rounded-2xl flex flex-col p-4 mt-6">
            <div className="pb-3 border-b border-[#1f212e] mb-4 flex justify-between items-center">
              <div className="flex flex-col">
                <h2 className="text-[12px] uppercase tracking-[1px] text-indigo-400 font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-indigo-400" />
                  Jupiter System Logs
                </h2>
                <span className="text-[9px] text-slate-500 uppercase font-mono mt-0.5">Real-time RPC & Jupiter Engine Execution Logs</span>
              </div>
            </div>

            <div className="overflow-y-auto max-h-[300px] pr-2 space-y-2 font-mono text-[10px] scrollbar-none">
              {jupiterLogs && jupiterLogs.length === 0 ? (
                <div className="text-center text-[#64748b] py-8 text-[11px]">No system logs recorded yet.</div>
              ) : (
                jupiterLogs?.map((log) => (
                  <div key={log.id} className="bg-[#0a0b14] border border-[#1f212e]/60 rounded-lg p-2.5 flex items-start gap-3 hover:bg-[#1f212e]/20 transition-colors">
                    <span className="text-slate-500 shrink-0 mt-0.5">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit', fractionalSecondDigits: 3 })}
                    </span>
                    <div className="flex flex-col flex-1 gap-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[8px] font-black tracking-wider uppercase",
                          log.type === 'QUOTE' ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                          log.type === 'SWAP' ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                          log.type === 'ERROR' ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                          "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                        )}>
                          {log.type}
                        </span>
                        <span className={cn(
                          "font-bold break-words flex-1",
                          log.type === 'ERROR' ? "text-rose-400" : "text-slate-300"
                        )}>
                          {log.message}
                        </span>
                        {(() => {
                          const logStr = `${log.message} ${typeof log.details === 'object' ? JSON.stringify(log.details) : String(log.details || '')}`;
                          const matchAddr = logStr.match(/(?:outputMint|inputMint|tokenAddress|address|mint)[\"':\s]+([a-zA-Z0-9]{32,44})/i) ||
                                            logStr.match(/\b([a-zA-Z0-9]{32,44}(?:pump)?)\b/);
                          if (matchAddr && matchAddr[1] && matchAddr[1] !== 'So11111111111111111111111111111111111111112') {
                            const mint = matchAddr[1];
                            return (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  executeSimRealBuy(mint, 0.1);
                                }}
                                className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 border border-emerald-500/40 transition-all flex items-center gap-1 shrink-0 active:scale-95 cursor-pointer ml-auto"
                                title={`Execute direct swap for token ${mint}`}
                              >
                                <Zap className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />
                                <span>BUY</span>
                              </button>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      {log.details && (
                        <div className="mt-1 bg-[#05050a] rounded border border-[#1f212e]/50 p-2 overflow-x-auto text-[9px] text-slate-400 break-all whitespace-pre-wrap">
                          {typeof log.details === 'object' ? JSON.stringify(log.details, null, 2) : String(log.details)}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Wallet Trades history */}
        <div className="lg:col-span-7">
          {/* Zustand Buy Signals Pipeline Dashboard */}
          <div className="bg-[#10111a]/60 border border-[#1f212e] rounded-2xl flex flex-col p-4 mb-6">
            <div className="pb-3 border-b border-[#1f212e] mb-4 flex justify-between items-center">
              <div className="flex flex-col">
                <h2 className="text-[12px] uppercase tracking-[1px] text-emerald-400 font-bold flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  Cross-Page Buy Signals Pipeline
                </h2>
                <span className="text-[9px] text-slate-500 uppercase font-mono mt-0.5">Zustand Real-Time Signal Bridge (PnLPage → SimRealPage)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded border border-emerald-500/20 font-bold">
                  {signals.length} Signals Captured
                </span>
                {signals.length > 0 && (
                  <button
                    onClick={clearSignals}
                    className="text-[9px] font-mono text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 px-2 py-0.5 rounded uppercase font-bold transition-all active:scale-95"
                    title="Erase all captured buy signals from pipeline"
                  >
                    Erase Pipeline
                  </button>
                )}
              </div>
            </div>

            {/* Signal Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-[#0a0b14] border border-[#1f212e] rounded-xl p-3 flex flex-col">
                <span className="text-[9px] text-slate-500 font-mono uppercase">Total Emitted</span>
                <span className="text-lg font-mono font-black text-white">{stats.totalEmitted}</span>
              </div>
              <div className="bg-[#0a0b14] border border-[#1f212e] rounded-xl p-3 flex flex-col">
                <span className="text-[9px] text-slate-500 font-mono uppercase">Total Executed</span>
                <span className="text-lg font-mono font-black text-emerald-400">{stats.totalExecuted}</span>
              </div>
              <div className="bg-[#0a0b14] border border-[#1f212e] rounded-xl p-3 flex flex-col">
                <span className="text-[9px] text-slate-500 font-mono uppercase">Total Failed</span>
                <span className="text-lg font-mono font-black text-rose-400">{stats.totalFailed}</span>
              </div>
              <div className="bg-[#0a0b14] border border-[#1f212e] rounded-xl p-3 flex flex-col">
                <span className="text-[9px] text-slate-500 font-mono uppercase">Total Rejected</span>
                <span className="text-lg font-mono font-black text-amber-400">{stats.totalRejected}</span>
              </div>
            </div>

            {/* Active Signals Queue / History */}
            <div className="overflow-x-auto max-h-[250px] scrollbar-none">
              {signals.length === 0 ? (
                <div className="text-center text-[#64748b] py-8 text-[11px] font-mono">
                  No signals received in this session yet. Waiting for any simulated position on the PnLPage to cross +1% profit...
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-[10px] font-mono whitespace-nowrap">
                  <thead>
                    <tr className="text-[#64748b] border-b border-[#1f212e]">
                      <th className="pb-2 font-medium pr-4">Timestamp</th>
                      <th className="pb-2 font-medium pr-4">Token</th>
                      <th className="pb-2 font-medium pr-4">Emit Profit %</th>
                      <th className="pb-2 font-medium pr-4">Status</th>
                      <th className="pb-2 font-medium">Outcome / Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(signals || [])].reverse().slice(0, 15).map(sig => {
                      const ageSec = Math.floor((Date.now() - sig.timestamp) / 1000);
                      let ageString = `${ageSec}s ago`;
                      if (ageSec >= 60) {
                        ageString = `${Math.floor(ageSec / 60)}m ${ageSec % 60}s ago`;
                      }

                      return (
                        <tr key={sig.id} className="border-b border-[#1f212e]/50 last:border-0 hover:bg-[#1f212e]/30 transition-colors">
                          <td className="py-2 text-slate-400 pr-4">{ageString}</td>
                          <td className="py-2 font-bold text-white pr-4">
                            <span className="text-[#c7f284]">{sig.symbol}</span>
                            <span className="text-[8px] text-slate-500 ml-1">({sig.tokenAddress.slice(0, 4)}...{sig.tokenAddress.slice(-4)})</span>
                          </td>
                          <td className="py-2 text-[#c7f284] pr-4 font-black">
                            {sig.profitPercent !== undefined && !isNaN(sig.profitPercent)
                              ? `${sig.profitPercent >= 0 ? '+' : ''}${sig.profitPercent.toFixed(2)}%`
                              : '+3.50%'}
                          </td>
                          <td className="py-2 pr-4">
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider",
                              sig.status === 'pending' ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                              sig.status === 'picked_up' ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse" :
                              sig.status === 'executed' ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                              sig.status === 'rejected' ? "bg-slate-500/10 text-slate-400 border border-slate-500/20" :
                              "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            )}>
                              {sig.status}
                            </span>
                          </td>
                          <td className="py-2 text-slate-300 max-w-[200px] truncate">
                            {sig.status === 'executed' && sig.txSignature && (
                              <span className="text-emerald-400 font-semibold text-[9px] break-all">
                                {sig.txSignature}
                              </span>
                            )}
                            {(sig.status === 'rejected' || sig.status === 'failed') && sig.rejectionReason && (
                              <span className="text-slate-400 text-[9px]">
                                {sig.rejectionReason}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="bg-[#10111a]/60 border border-[#1f212e] rounded-2xl flex flex-col p-4">
            <div className="pb-3 border-b border-[#1f212e] mb-4 flex justify-between items-center">
              <div className="flex flex-col">
                <h2 className="text-[12px] uppercase tracking-[1px] text-emerald-400 font-bold">Simreal Wallet Trades</h2>
                <span className="text-[9px] text-slate-500 uppercase font-mono mt-0.5">Automated Active Positions Copy</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded border border-emerald-500/20 font-bold">
                {completedTrades.length} Completed
              </span>
            </div>

            <div className="overflow-x-auto">
              {completedTrades.length === 0 ? (
                <div className="text-center text-[#64748b] py-12 text-[12px] font-mono">No simreal trades completed yet. Active copy trades will compile here.</div>
              ) : (
                <table className="w-full text-left border-collapse text-[11px] font-mono whitespace-nowrap">
                  <thead>
                    <tr className="text-[#64748b] border-b border-[#1f212e]">
                      <th className="pb-2 font-medium pr-4">Token Address</th>
                      <th className="pb-2 font-medium pr-4">Token Amount</th>
                      <th className="pb-2 font-medium pr-4">Buy Time</th>
                      <th className="pb-2 font-medium pr-4">Hold Time</th>
                      <th className="pb-2 font-medium text-right pr-4">Buy SOL</th>
                      <th className="pb-2 font-medium text-right pr-4">Sell SOL</th>
                      <th className="pb-2 font-medium text-right pr-4">Profit SOL</th>
                      <th className="pb-2 font-medium text-right">PnL (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedTrades.map(trade => {
                      const mintDisplay = trade.mint.length > 12 ? `${trade.mint.slice(0, 6)}...${trade.mint.slice(-6)}` : trade.mint || 'Unknown';
                      const holdMs = trade.sellTime - trade.buyTime;
                      const holdSec = Math.floor(holdMs / 1000) % 60;
                      const holdMin = Math.floor(holdMs / 60000) % 60;
                      const holdHr = Math.floor(holdMs / 3600000);
                      
                      let holdString = '';
                      if (trade.buyTime === 0) {
                        holdString = 'UNMATCHED';
                      } else {
                        if (holdHr > 0) holdString += `${holdHr}h `;
                        if (holdMin > 0 || holdHr > 0) holdString += `${holdMin}m `;
                        holdString += `${holdSec}s`;
                      }

                      const profitSol = trade.buyAmountSol > 0 ? trade.sellAmountSol - trade.buyAmountSol : 0;
                      
                      const formattedTokens = trade.tokenAmount !== undefined 
                        ? `${trade.tokenAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })} tokens`
                        : '—';

                      return (
                        <tr key={trade.id} className="border-b border-[#1f212e]/50 last:border-0 hover:bg-[#1f212e]/30 transition-colors">
                          <td className="py-2.5 text-[#e2e8f0] pr-4">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[#c7f284] font-bold">{trade.token}</span>
                              <button 
                                onClick={() => handleCopy(trade.mint, trade.id)}
                                className="group flex items-center gap-1 bg-[#151622] hover:bg-[#1f212e] text-slate-400 hover:text-white px-1.5 py-0.5 rounded border border-[#1f212e] cursor-pointer transition-all"
                                title="Click to copy full token address"
                              >
                                <span className="text-slate-500 text-[10px] group-hover:text-slate-300 font-mono">
                                  {mintDisplay}
                                </span>
                                {copiedId === trade.id ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3 text-slate-500 group-hover:text-slate-300 opacity-60 group-hover:opacity-100 transition-opacity" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="py-2.5 text-slate-300 pr-4">
                            {formattedTokens}
                          </td>
                          <td className="py-2.5 text-[#e2e8f0] pr-4">
                            {trade.buyTime === 0 ? 'N/A' : new Date(trade.buyTime).toLocaleTimeString()}
                          </td>
                          <td className="py-2.5 text-[#e2e8f0] pr-4">
                            {holdString}
                          </td>
                          <td className="py-2.5 text-[#e2e8f0] text-right pr-4">
                            {trade.buyTime === 0 ? 'N/A' : `${trade.buyAmountSol.toFixed(4)} SOL`}
                          </td>
                          <td className="py-2.5 text-[#e2e8f0] text-right pr-4">
                            {trade.sellAmountSol.toFixed(4)} SOL
                          </td>
                          <td className={`py-2.5 text-right pr-4 font-bold ${trade.buyTime === 0 ? 'text-[#e2e8f0]' : profitSol >= 0 ? 'text-[#c7f284]' : 'text-[#ff4d4d]'}`}>
                            {trade.buyTime === 0 ? 'N/A' : `${profitSol >= 0 ? '+' : ''}${profitSol.toFixed(4)} SOL`}
                          </td>
                          <td className={`py-2.5 text-right font-bold ${trade.buyTime === 0 ? 'text-[#e2e8f0]' : trade.pnlPct >= 0 ? 'text-[#c7f284]' : 'text-[#ff4d4d]'}`}>
                            {trade.buyTime === 0 ? 'N/A' : `${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(2)}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[#1f212e] font-black bg-[#10111a]/80 text-[#e2e8f0]">
                      <td className="py-3 text-left pl-2 text-emerald-400 text-[11px]" colSpan={4}>
                        TOTAL PORTFOLIO PERFORMANCE
                      </td>
                      <td className="py-3 text-[#e2e8f0] text-right pr-4 font-mono">
                        {totalBuySol.toFixed(4)} SOL
                      </td>
                      <td className="py-3 text-[#e2e8f0] text-right pr-4 font-mono">
                        {totalSellSol.toFixed(4)} SOL
                      </td>
                      <td className={`py-3 text-right pr-4 font-mono font-bold ${totalProfitSol >= 0 ? 'text-[#c7f284]' : 'text-[#ff4d4d]'}`}>
                        {totalProfitSol >= 0 ? '+' : ''}{totalProfitSol.toFixed(4)} SOL
                      </td>
                      <td className={`py-3 text-right font-mono font-bold ${totalPnlPct >= 0 ? 'text-[#c7f284]' : 'text-[#ff4d4d]'}`}>
                        {totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
