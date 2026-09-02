import { SniperTrade } from '../types';
import { useAppStore } from '../store/appStore';

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
  const currentNetwork = network || (typeof localStorage !== 'undefined' ? localStorage.getItem('trade_mode') : null) || 'paper';

  let storeState: any = null;
  try { storeState = useAppStore.getState(); } catch {}

  const allTradesList: SniperTrade[] = [
    ...(trades || []),
    ...(storeState?.mySniperTrades || []),
    ...(storeState?.trades || [])
  ];

  const counted = new Set<string>();
  let completedBuys = 0;

  for (const t of allTradesList) {
    if (!t || t.type !== 'BUY') continue;
    const tradeNet = (t as any).network || (t as any).mode ||
      (t.id?.startsWith('SIM') || t.signature?.startsWith('SIM') ? 'paper' : 'mainnet');
    if (tradeNet !== currentNetwork) continue;

    const uniqueKey = t.id || t.signature || `${t.address}-${t.timestamp}`;
    if (counted.has(uniqueKey)) continue;

    const tAddr = normalizeAddress(t.address || (t as any).mint || (t as any).tokenAddress);
    const tSym = normalizeSymbol(t.token);
    const matches = (normAddr && tAddr && tAddr === normAddr) ||
      (normSym && tSym && normSym === tSym && normSym.length > 2);
    if (matches) { counted.add(uniqueKey); completedBuys++; }
  }

  // A live position is already represented by its BUY history. Do not count it
  // again or the first rebuy would be rejected one trade too early.
  let activeForToken = false;
  const activePositionsMap = { ...(positions || {}), ...(storeState?.activePositions || {}) };
  for (const [key, pos] of Object.entries(activePositionsMap)) {
    if (!pos) continue;
    const p = pos as any;
    const posNet = p.network || p.mode || (key.toLowerCase().startsWith('sim') ? 'paper' : 'mainnet');
    if (posNet !== currentNetwork) continue;
    const pAddr = normalizeAddress(key || p.address || p.mint);
    const pSym = normalizeSymbol(p.symbol);
    if ((p.amount > 0 || p.solSpent > 0) &&
        ((normAddr && pAddr === normAddr) || (normSym && pSym === normSym && normSym.length > 2))) {
      activeForToken = true;
      break;
    }
  }

  // Reserve exactly one additional trade while a BUY is in flight.
  const pending = pendingQueue?.has(tokenAddress) ||
    (pendingQueue ? Array.from(pendingQueue).some(a => normalizeAddress(a) === normAddr) : false);
  return completedBuys + (pending ? 1 : 0);
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
        ? `TOKEN_ALREADY_TRADED_ONCE (Trade Count: ${count}, Policy: Trade Only Once / No Rebuy)`
        : `MAX_REBUY_EXCEEDED (Trade Count: ${count} >= Limit: ${maxAllowed})`,
    };
  }

  return {
    allowed: true,
    count,
    maxAllowed,
  };
}


