import { SniperTrade } from '../types';
import { useAppStore } from '../store/appStore';

export type RebuyNetwork = 'paper' | 'mainnet';

function normalizeAddress(addr: string | undefined): string {
  return (addr || '').trim().toLowerCase();
}

function normalizeSymbol(sym: string | undefined): string {
  const cleaned = (sym || '').trim().toLowerCase();
  if (['unknown', 'sim', 'sol', 'usdc', 'usdt', 'pump', 'raydium'].includes(cleaned)) return '';
  return cleaned;
}

function currentNetwork(network?: string): RebuyNetwork {
  if (network === 'mainnet' || network === 'paper') return network;
  try {
    const n = useAppStore.getState()?.isLiveTrading ? 'mainnet' : localStorage.getItem('trade_mode');
    return n === 'mainnet' ? 'mainnet' : 'paper';
  } catch { return 'paper'; }
}

function tradeNetwork(t: any): RebuyNetwork | null {
  if (t?.network === 'mainnet' || t?.network === 'paper') return t.network;
  // Legacy records are deliberately not guessed as mainnet from arbitrary IDs.
  // Only explicit SIM legacy records can safely be classified as paper.
  if (t?.id?.startsWith('SIM') || t?.signature?.startsWith('SIM')) return 'paper';
  return null;
}

export function getTradeCount(
  tokenAddress: string,
  symbol: string | undefined,
  trades: SniperTrade[],
  positions: Record<string, any>,
  pendingQueue?: Set<string>,
  network?: string
): number {
  if (!tokenAddress) return 0;
  const normAddr = normalizeAddress(tokenAddress);
  const normSym = normalizeSymbol(symbol);
  const net = currentNetwork(network);

  let storeState: any = null;
  try { storeState = useAppStore.getState(); } catch {}

  const allTradesList = [
    ...(trades || []),
    ...(storeState?.mySniperTrades || []),
    ...(storeState?.trades || []),
  ];

  const seen = new Set<string>();
  let completedBuys = 0;
  for (const t of allTradesList) {
    if (!t || t.type !== 'BUY') continue;
    const tNet = tradeNetwork(t);
    if (tNet !== net) continue;
    const key = t.signature || t.id || `${t.address || ''}:${t.timestamp || ''}`;
    if (seen.has(key)) continue;
    const addr = normalizeAddress(t.address || (t as any).mint || (t as any).tokenAddress);
    const sym = normalizeSymbol(t.token);
    if ((addr && addr === normAddr) || (normSym && sym && sym === normSym && normSym.length > 2)) {
      seen.add(key);
      completedBuys++;
    }
  }

  // Active position is a state guard, not an additional completed BUY.
  // A successful BUY is already represented in history, so counting both inflated the limit.
  // Pending is a reservation only. It is checked by isRebuyAllowed, but never added to the completed trade count.
  return completedBuys;
}

export interface RebuyValidationOptions {
  tradeOnlyOnce?: boolean;
  maxRebuyTimes?: number;
  trades?: SniperTrade[];
  positions?: Record<string, any>;
  pendingQueue?: Set<string>;
  network?: string;
}

export function isRebuyAllowed(tokenAddress: string, symbol: string | undefined, options: RebuyValidationOptions = {}) {
  const storeState = useAppStore.getState();
  const isTradeOnce = options.tradeOnlyOnce ?? storeState.tradeOnlyOnce ?? true;
  const maxAllowed = isTradeOnce ? 1 : Math.max(1, Math.floor(options.maxRebuyTimes ?? storeState.maxRebuyTimes ?? 1));
  const pending = !!options.pendingQueue && [...options.pendingQueue].some(a => normalizeAddress(a) === normalizeAddress(tokenAddress));
  if (pending) {
    return { allowed: false, count: 0, maxAllowed, reason: 'ENTRY_ALREADY_PENDING' };
  }
  const count = getTradeCount(tokenAddress, symbol, options.trades || storeState.mySniperTrades || [], options.positions || storeState.activePositions || {}, options.pendingQueue, options.network);
  if (count >= maxAllowed) {
    return { allowed: false, count, maxAllowed, reason: isTradeOnce ? 'TOKEN_ALREADY_TRADED_ONCE' : 'MAX_REBUY_EXCEEDED' };
  }
  return { allowed: true, count, maxAllowed };
}
