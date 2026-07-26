import { SniperTrade } from '../types';

export function getSimRealTradeCount(
  tokenAddress: string,
  symbol: string | undefined,
  simRealTrades: SniperTrade[],
  positions: Record<string, any>,
  simRealBoughtPending?: Set<string>
): number {
  if (!tokenAddress) return 0;
  const normAddr = tokenAddress.toLowerCase().trim();
  const normSym = symbol ? symbol.toLowerCase().trim() : '';

  // 1. Count completed BUY trades in simRealTrades history
  const completedBuys = (simRealTrades || []).filter((t) => {
    if (t.type !== 'BUY') return false;
    const tAddr = (t.address || (t as any).mint || '').toLowerCase().trim();
    const tSym = (t.token || '').toLowerCase().trim();
    return (
      (normAddr && tAddr === normAddr) ||
      (normSym && normSym !== 'unknown' && normSym !== 'sim' && tSym === normSym)
    );
  }).length;

  // 2. Count active position if simRealBought is true
  let isActive = 0;
  if (positions) {
    for (const [key, pos] of Object.entries(positions)) {
      if (!pos) continue;
      const pAddr = key.toLowerCase().trim();
      const pSym = (pos.symbol || '').toLowerCase().trim();
      if (
        pos.simRealBought &&
        ((normAddr && pAddr === normAddr) ||
          (normSym && normSym !== 'unknown' && pSym === normSym))
      ) {
        isActive = 1;
        break;
      }
    }
  }

  // 3. Count pending in-flight buy attempts
  let isPending = 0;
  if (simRealBoughtPending) {
    for (const pendingAddr of simRealBoughtPending) {
      if (pendingAddr && pendingAddr.toLowerCase().trim() === normAddr) {
        isPending = 1;
        break;
      }
    }
  }

  return completedBuys + isActive + isPending;
}
