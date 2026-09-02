export type WalletTradeSide = 'buy' | 'sell';

export interface ParsedWalletTrade {
  type: WalletTradeSide;
  mint: string;
  amount: number;
  timestampMs: number;
  owner: string;
}

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

type UnknownRecord = Record<string, unknown>;
const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === 'object' ? value as UnknownRecord : null;

function rawToUi(raw: unknown, decimals: unknown): number | null {
  const rawString = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : null;
  const decimalNumber = typeof decimals === 'number' ? decimals : Number(decimals);
  if (!rawString || !/^\d+$/.test(rawString) || !Number.isInteger(decimalNumber) || decimalNumber < 0 || decimalNumber > 30) return null;
  const rawBig = BigInt(rawString);
  const divisor = 10n ** BigInt(decimalNumber);
  const whole = rawBig / divisor;
  const fraction = rawBig % divisor;
  const value = Number(whole) + Number(fraction) / Number(divisor);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Parses only token balance deltas owned by the monitored wallet. It never
 * guesses an amount and never uses an arbitrary first token balance.
 */
export function parseWalletTransaction(tx: unknown, monitoredWallet: string): ParsedWalletTrade | null {
  const root = asRecord(tx);
  if (!root || !monitoredWallet) return null;

  const meta = asRecord(root.meta);
  if (meta) {
    const pre = Array.isArray(meta.preTokenBalances) ? meta.preTokenBalances : [];
    const post = Array.isArray(meta.postTokenBalances) ? meta.postTokenBalances : [];
    const balances = new Map<string, { mint: string; decimals: number; pre: bigint; post: bigint }>();

    const add = (entry: unknown, side: 'pre' | 'post') => {
      const row = asRecord(entry);
      const owner = row?.owner;
      const mint = row?.mint;
      const ui = asRecord(row?.uiTokenAmount);
      const raw = ui?.amount;
      const decimals = Number(ui?.decimals);
      if (owner !== monitoredWallet || typeof mint !== 'string' || mint === WSOL_MINT || !Number.isInteger(decimals) || decimals < 0) return;
      if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return;
      const current = balances.get(mint) || { mint, decimals, pre: 0n, post: 0n };
      current.decimals = decimals;
      current[side] += BigInt(raw);
      balances.set(mint, current);
    };

    pre.forEach(entry => add(entry, 'pre'));
    post.forEach(entry => add(entry, 'post'));

    let best: { mint: string; decimals: number; delta: bigint } | null = null;
    for (const value of balances.values()) {
      const delta = value.post - value.pre;
      if (delta === 0n) continue;
      if (!best || (delta < 0n ? -delta : delta) > (best.delta < 0n ? -best.delta : best.delta)) {
        best = { mint: value.mint, decimals: value.decimals, delta };
      }
    }

    if (best) {
      const amount = rawToUi((best.delta < 0n ? -best.delta : best.delta).toString(), best.decimals);
      if (amount && amount > 0) {
        const blockTime = typeof root.blockTime === 'number' ? root.blockTime * 1000 : Date.now();
        return { type: best.delta > 0n ? 'buy' : 'sell', mint: best.mint, amount, timestampMs: blockTime, owner: monitoredWallet };
      }
    }
  }

  // Helius enriched transaction fallback. Only accept transfers where the
  // monitored wallet is explicitly the sender or recipient.
  const transfers = Array.isArray(root.tokenTransfers) ? root.tokenTransfers : [];
  let bestTransfer: ParsedWalletTrade | null = null;
  for (const item of transfers) {
    const transfer = asRecord(item);
    if (!transfer || transfer.mint === WSOL_MINT || typeof transfer.mint !== 'string') continue;
    const from = typeof transfer.fromUserAccount === 'string' ? transfer.fromUserAccount : '';
    const to = typeof transfer.toUserAccount === 'string' ? transfer.toUserAccount : '';
    if (from !== monitoredWallet && to !== monitoredWallet) continue;
    const amount = Number(transfer.tokenAmount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const timestamp = typeof root.timestamp === 'number' ? root.timestamp * 1000 : Date.now();
    const candidate: ParsedWalletTrade = {
      type: to === monitoredWallet ? 'buy' : 'sell',
      mint: transfer.mint,
      amount,
      timestampMs: timestamp,
      owner: monitoredWallet,
    };
    if (!bestTransfer || candidate.amount > bestTransfer.amount) bestTransfer = candidate;
  }
  return bestTransfer;
}
