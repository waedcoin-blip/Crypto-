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

export function getSimRealTradeCount(
  tokenAddress: string,
  symbol: string | undefined,
  trades: SniperTrade[],
  positions: Record<string, any>,
  pendingQueue?: Set<string>,
  isSimReal: boolean = true
): number {
  if (!tokenAddress) return 0;

  const normAddr = normalizeAddress(tokenAddress);
  const normSym = normalizeSymbol(symbol);

  // Combine trades from argument AND global store to ensure no trades are missed
  let storeState: any = null;
  try {
    storeState = useAppStore.getState();
  } catch {}

  const allTradesList: SniperTrade[] = [
    ...(trades || []),
    ...(storeState?.simRealTrades || []),
    ...(storeState?.mySniperTrades || []),
    ...(storeState?.trades || [])
  ];

  // 1. Count completed BUY trades in trades history
  const countedSignatures = new Set<string>();
  let completedBuys = 0;

  for (const t of allTradesList) {
    if (!t || t.type !== 'BUY') continue;

    // Avoid double counting same trade signature/id if present in multiple lists
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

  // 2. Count active position
  let isActive = 0;
  const activePositionsMap = {
    ...(positions || {}),
    ...(storeState?.activePositions || {})
  };

  for (const [key, pos] of Object.entries(activePositionsMap)) {
    if (!pos) continue;
    const p = pos as any;
    const pAddr = normalizeAddress(key || p?.address || p?.mint);
    const pSym = normalizeSymbol(p?.symbol);

    const isActivePos = isSimReal 
      ? !!p?.simRealBought 
      : (p?.amount !== undefined && p.amount > 0) || (p?.solSpent !== undefined && p.solSpent > 0);

    if (isActivePos) {
      const matchByAddr = normAddr && pAddr && pAddr === normAddr;
      const matchBySym = normSym && pSym && normSym === pSym && normSym.length > 2;
      if (matchByAddr || matchBySym) {
        isActive = 1;
        break;
      }
    }
  }

  // 3. Count pending in-flight buy attempts
  let isPending = 0;
  if (pendingQueue) {
    for (const pendingAddr of pendingQueue) {
      if (pendingAddr && normalizeAddress(pendingAddr) === normAddr) {
        isPending = 1;
        break;
      }
    }
  }

  return Math.max(completedBuys, isActive) + isPending;
}

export function getTradeCount(
  tokenAddress: string,
  symbol: string | undefined,
  trades: SniperTrade[],
  positions: Record<string, any>,
  pendingMints?: Set<string>
): number {
  return getSimRealTradeCount(tokenAddress, symbol, trades, positions, pendingMints, false);
}

