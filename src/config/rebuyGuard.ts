import { SniperTrade } from '../types';

export function getSimRealTradeCount(
  tokenAddress: string,
  symbol: string | undefined,
  trades: SniperTrade[],
  positions: Record<string, any>,
  pendingQueue?: Set<string>,
  isSimReal: boolean = true
): number {
  if (!tokenAddress) return 0;
  const normAddr = tokenAddress.toLowerCase().trim();
  const normSym = symbol ? symbol.toLowerCase().trim() : '';

  // 1. Count completed BUY trades in trades history
  const completedBuys = (trades || []).filter((t) => {
    if (t.type !== 'BUY') return false;
    const tAddr = (t.address || (t as any).mint || '').toLowerCase().trim();
    const tSym = (t.token || '').toLowerCase().trim();
    return (
      (normAddr && tAddr === normAddr) ||
      (normSym && normSym !== 'unknown' && normSym !== 'sim' && tSym === normSym)
    );
  }).length;

  // 2. Count active position
  let isActive = 0;
  if (positions) {
    for (const [key, pos] of Object.entries(positions)) {
      if (!pos) continue;
      const pAddr = key.toLowerCase().trim();
      const pSym = (pos.symbol || '').toLowerCase().trim();
      
      const isActivePos = isSimReal 
        ? !!pos.simRealBought 
        : (pos.amount !== undefined && pos.amount > 0);
        
      if (
        isActivePos &&
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
  if (pendingQueue) {
    for (const pendingAddr of pendingQueue) {
      if (pendingAddr && pendingAddr.toLowerCase().trim() === normAddr) {
        isPending = 1;
        break;
      }
    }
  }

  // Wait, if it's currently active (or pending) it counts as 1 towards the limit.
  // We ONLY want to limit the total number of entries into a position.
  // But wait, if we buy 1 time, completedBuys = 1. isActive = 1.
  // total = 2. But the user only entered ONCE!
  // We should return Math.max(completedBuys, isActive + isPending).
  // Wait, if we bought 1 time, and it's active, completedBuys is 1, isActive is 1. We traded 1 time.
  // If we sold it, completedBuys is 1, isActive is 0. We traded 1 time.
  // If we bought it again, completedBuys is 2, isActive is 1. We traded 2 times.
  // So the total number of trades is exactly completedBuys (plus isPending if there's a trade in-flight that hasn't registered in trades yet).
  // Let's fix this to accurately count trades.
  
  return completedBuys + isPending;
}

export function getTradeCount(
  tokenAddress: string,
  symbol: string | undefined,
  trades: SniperTrade[],
  positions: Record<string, any>,
  pendingMints?: Set<string>
): number {
  if (!tokenAddress) return 0;

  const normAddr = tokenAddress.toLowerCase().trim();
  const normSym = symbol ? symbol.toLowerCase().trim() : '';

  // 1. Count completed BUY trades
  const completedBuys = (trades || []).filter((t) => {
    if (t.type !== 'BUY') return false;
    const tAddr = (t.address || (t as any).mint || '').toLowerCase().trim();
    const tSym = (t.token || '').toLowerCase().trim();
    return (
      (normAddr && tAddr === normAddr) ||
      (normSym && normSym !== 'unknown' && normSym !== 'sim' && tSym === normSym)
    );
  }).length;

  // 2. Count active position if it has amount > 0
  let isActive = 0;
  if (positions) {
    for (const [key, pos] of Object.entries(positions)) {
      if (!pos) continue;
      const pAddr = key.toLowerCase().trim();
      const pSym = (pos.symbol || '').toLowerCase().trim();
      if (
        pos.amount > 0 &&
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
  if (pendingMints) {
    for (const pendingAddr of pendingMints) {
      if (pendingAddr && pendingAddr.toLowerCase().trim() === normAddr) {
        isPending = 1;
        break;
      }
    }
  }

  return completedBuys + isPending;
}
