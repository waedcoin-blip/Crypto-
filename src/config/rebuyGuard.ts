import { SniperTrade } from '../types';
import { useAppStore } from '../store/appStore';
import { tokenLifecycleManager } from '../services/TokenLifecycleManager';

function normalizeAddress(addr: string | undefined): string {
  if (!addr) return '';
  return addr.trim().toLowerCase();
}

function normalizeSymbol(sym: string | undefined): string {
  if (!sym) return '';
  const cleaned = sym.trim().toLowerCase();
  if (['unknown', 'sim', 'sol', 'usdc', 'usdt', 'pump', 'raydium'].includes(cleaned)) {
    return '';
  }
  return cleaned;
}

/**
 * Returns the count of trades EXECUTED BY OUR SYSTEM for a given token.
 * Crucial Fix: Public market trade observations (storeState.trades) are NEVER
 * counted as system trades!
 */
export function getTradeCount(
  tokenAddress: string,
  symbol: string | undefined,
  trades?: SniperTrade[],
  positions?: Record<string, any>,
  pendingQueue?: Set<string>,
  network?: string
): number {
  if (!tokenAddress) return 0;

  const normAddr = normalizeAddress(tokenAddress);
  const normSym = normalizeSymbol(symbol);
  const currentNetwork = network || (typeof localStorage !== 'undefined' ? localStorage.getItem('trade_mode') : null) || 'paper';

  let storeState: any = null;
  try {
    storeState = useAppStore.getState();
  } catch {}

  // ONLY count mySniperTrades (user/system executed trades)
  const myExecutedTrades: SniperTrade[] = [
    ...(trades || []),
    ...(storeState?.mySniperTrades || [])
  ];

  const countedSignatures = new Set<string>();
  let completedBuys = 0;

  for (const t of myExecutedTrades) {
    if (!t || t.type !== 'BUY') continue;

    const tradeNet = (t as any).network || (t as any).mode || (t.id?.startsWith('SIM') || t.signature?.startsWith('SIM') ? 'paper' : 'mainnet');
    if (tradeNet !== currentNetwork) continue;

    const uniqueKey = t.id || t.signature || `${t.address}-${t.timestamp}`;
    if (countedSignatures.has(uniqueKey)) continue;

    const tAddr = normalizeAddress(t.address || (t as any).mint || (t as any).tokenAddress || (t.token && t.token.length >= 32 ? t.token : undefined));
    const tSym = normalizeSymbol(t.token);

    const matchByAddr = normAddr && tAddr && tAddr === normAddr;
    const matchBySym = normSym && tSym && normSym === tSym && normSym.length > 2;

    if (matchByAddr || matchBySym) {
      countedSignatures.add(uniqueKey);
      completedBuys++;
    }
  }

  // Count active position matching current network
  let isActive = 0;
  const activePositionsMap = {
    ...(positions || {}),
    ...(storeState?.activePositions || {})
  };

  for (const [key, pos] of Object.entries(activePositionsMap)) {
    if (!pos) continue;
    const p = pos as any;

    const posNet = p.network || p.mode || (key.toLowerCase().startsWith('sim') || p.mint?.toLowerCase().startsWith('sim') ? 'paper' : 'mainnet');
    if (posNet !== currentNetwork) continue;

    const pAddr = normalizeAddress(key || p?.address || p?.mint);
    const pSym = normalizeSymbol(p?.symbol);

    const isActivePos = (p?.amount !== undefined && p.amount > 0) || (p?.solSpent !== undefined && p.solSpent > 0);

    if (isActivePos) {
      const matchByAddr = normAddr && pAddr && pAddr === normAddr;
      const matchBySym = normSym && pSym && normSym === pSym && normSym.length > 2;
      if (matchByAddr || matchBySym) {
        isActive = 1;
        break;
      }
    }
  }

  // Count pending in-flight buy attempts
  let isPending = 0;
  if (pendingQueue) {
    for (const pendingAddr of pendingQueue) {
      if (pendingAddr && normalizeAddress(pendingAddr) === normAddr) {
        isPending = 1;
        break;
      }
    }
  }

  const systemLifecycleCount = tokenLifecycleManager.getCompletedTradeCount(tokenAddress);

  return Math.max(completedBuys, systemLifecycleCount, isActive) + isPending;
}

export interface RebuyValidationOptions {
  tradeOnlyOnce?: boolean;
  maxRebuyTimes?: number;
  trades?: SniperTrade[];
  positions?: Record<string, any>;
  pendingQueue?: Set<string>;
  network?: string;
}

export function isRebuyAllowed(
  tokenAddress: string,
  symbol: string | undefined,
  options?: RebuyValidationOptions
): { allowed: boolean; count: number; maxAllowed: number; reason?: string } {
  const storeState = typeof useAppStore !== 'undefined' ? useAppStore.getState() : null;
  const isTradeOnce = options?.tradeOnlyOnce ?? storeState?.tradeOnlyOnce ?? true;
  const maxAllowed = isTradeOnce ? 1 : Math.max(1, options?.maxRebuyTimes ?? storeState?.maxRebuyTimes ?? 1);

  // Check TokenLifecycleManager canonical state first
  const eligibility = tokenLifecycleManager.canTokenBeBought(tokenAddress, {
    tradeOnlyOnce: isTradeOnce,
    maxRebuyTimes: maxAllowed,
  });

  if (!eligibility.allowed) {
    return {
      allowed: false,
      count: eligibility.completedTrades,
      maxAllowed,
      reason: eligibility.reason,
    };
  }

  const count = getTradeCount(
    tokenAddress,
    symbol,
    options?.trades || storeState?.mySniperTrades || [],
    options?.positions || storeState?.activePositions || {},
    options?.pendingQueue,
    options?.network
  );

  if (count >= maxAllowed) {
    return {
      allowed: false,
      count,
      maxAllowed,
      reason: isTradeOnce
        ? `TOKEN_ALREADY_TRADED_ONCE (System Trade Count: ${count}, Policy: Trade Only Once)`
        : `MAX_REBUY_EXCEEDED (System Trade Count: ${count} >= Limit: ${maxAllowed})`,
    };
  }

  return {
    allowed: true,
    count,
    maxAllowed,
  };
}
