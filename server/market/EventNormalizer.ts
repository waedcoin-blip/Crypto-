// server/market/EventNormalizer.ts
import { tokenMintResolver } from './TokenMintResolver.js';

export interface MarketEvent {
  network: string;
  slot: number;
  signature: string;
  timestamp: number;
  type: 'ON_CHAIN_TX' | 'SLOT_UPDATE' | 'ACCOUNT_UPDATE' | 'PRICE_UPDATE';
  mint?: string;
  owner?: string;
  pool?: string;
  price?: number;
  tokenAmount?: number;
  accountKeys?: string[];
  raw?: any;
}

export class EventNormalizer {
  public static normalizeYellowstoneUpdate(update: any, network: string = 'mainnet'): MarketEvent | null {
    if (!update) return null;

    const now = Date.now();

    // Transaction update
    if (update.transaction) {
      const tx = update.transaction;
      const signature = tx.signature || tx.transaction?.signature || `sig_${now}`;
      const slot = Number(tx.slot || update.slot || 0);

      const accountKeys: string[] = [];
      const keys = tx.transaction?.transaction?.message?.accountKeys || tx.accountKeys || [];
      for (const k of keys) {
        if (typeof k === 'string') accountKeys.push(k);
        else if (k && typeof k.toString === 'function') accountKeys.push(k.toString());
      }

      const logs: string[] = tx.meta?.logMessages || tx.transaction?.meta?.logMessages || tx.logs || [];
      let extractedMint: string | undefined = undefined;

      // 1. Try log extraction
      const logMint = tokenMintResolver.extractMintFromLogs(logs);
      if (logMint) {
        extractedMint = logMint;
      } else {
        // 2. Scan account keys for first valid candidate mint
        const candidates = tokenMintResolver.extractCandidateMintsFromAccountKeys(accountKeys);
        if (candidates.length > 0) {
          extractedMint = candidates[0];
        }
      }

      return {
        network,
        slot,
        signature: typeof signature === 'string' ? signature : String(signature),
        timestamp: now,
        type: 'ON_CHAIN_TX',
        mint: extractedMint,
        accountKeys,
        raw: update,
      };
    }

    // Slot update
    if (update.slot) {
      return {
        network,
        slot: Number(update.slot.slot || update.slot || 0),
        signature: `slot_${update.slot}`,
        timestamp: now,
        type: 'SLOT_UPDATE',
        raw: update,
      };
    }

    return null;
  }
}

