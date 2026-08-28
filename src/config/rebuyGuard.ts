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

  // Combine trades from argument AND global store to ensure no trades are missed
  let storeState: any = null;
  try {
    storeState = useAppStore.getState();
  } catch {}

  const allTradesList: SniperTrade[] = [
    ...(trades || []),
    ...(storeState?.mySniperTrades || []),
    ...(storeState?.trades || [])
  ];

  // 1. Count completed BUY trades in trades history matching current network
  const countedSignatures = new Set<string>();
  let completedBuys = 0;

  for (const t of allTradesList) {
    if (!t || t.type !== 'BUY') continue;

    const tradeNet = (t as any).network || (t as any).mode || (t.id?.startsWith('SIM') || t.signature?.startsWith('SIM') ? 'paper' : 'mainnet');
    if (tradeNet !== currentNetwork) continue;

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

  // 2. Count active position matching current network
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


