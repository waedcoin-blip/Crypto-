// server/market/OnChainEventNormalizer.ts
import { MarketEvent } from './EventNormalizer.js';
import bs58 from 'bs58';

export interface NormalizedOnChainEvent extends MarketEvent {
  eventId: string;
  source: 'HELIUS_WSS' | 'YELLOWSTONE_GRPC' | 'SOLANA_RPC';
  transport: 'wss' | 'grpc';
  receivedAt: number;
  processedAt?: number;
  ingestionLatencyMs?: number;
  logMessages?: string[];
  err?: any;
  programId?: string;
  accountKeys?: string[];
}

export class OnChainEventNormalizer {
  /**
   * Generates a deterministic event ID to facilitate LRU deduplication.
   */
  public static generateEventId(
    source: string,
    type: string,
    slot: number,
    signature?: string,
    pubkey?: string
  ): string {
    if (signature && signature !== 'no-signature') {
      return `${source}:${signature}:${type}:${slot || 0}`;
    }
    if (pubkey) {
      return `${source}:${pubkey}:${type}:${slot || 0}`;
    }
    return `${source}:${type}:${slot || 0}`;
  }

  /**
   * Normalizes standard Solana JSON-RPC WebSocket notifications (from Helius WSS).
   */
  public static normalizeWssNotification(
    msg: any,
    network: string = 'mainnet'
  ): NormalizedOnChainEvent | null {
    if (!msg || typeof msg !== 'object') return null;

    const method = msg.method;
    const params = msg.params;
    if (!method || !params) return null;

    const now = Date.now();
    const result = params.result;

    // 1. Slot Notification
    if (method === 'slotNotification' && result) {
      const slot = Number(result.slot || 0);
      const eventId = this.generateEventId('HELIUS_WSS', 'SLOT_UPDATE', slot);
      return {
        eventId,
        source: 'HELIUS_WSS',
        transport: 'wss',
        network,
        slot,
        signature: `slot_${slot}`,
        timestamp: now,
        receivedAt: now,
        type: 'SLOT_UPDATE',
        raw: msg,
      };
    }

    // 2. Logs Notification (Transaction logs matching program/mint)
    if (method === 'logsNotification' && result) {
      const slot = Number(result.context?.slot || 0);
      const value = result.value || {};
      const signature = typeof value.signature === 'string' ? value.signature : `sig_${now}`;
      const logs = Array.isArray(value.logs) ? value.logs : [];
      const err = value.err || null;

      // Extract referenced accounts from log messages or signature context if present
      const accountKeys: string[] = [];
      
      // Look for Program log or Transfer mint candidates in logs
      for (const log of logs) {
        if (typeof log === 'string') {
          const match = log.match(/Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (?:invoke|success)/);
          if (match && match[1]) {
            accountKeys.push(match[1]);
          }
        }
      }

      const eventId = this.generateEventId('HELIUS_WSS', 'ON_CHAIN_TX', slot, signature);

      return {
        eventId,
        source: 'HELIUS_WSS',
        transport: 'wss',
        network,
        slot,
        signature,
        timestamp: now,
        receivedAt: now,
        type: 'ON_CHAIN_TX',
        accountKeys,
        logMessages: logs,
        err,
        raw: msg,
      };
    }

    // 3. Program / Account Notification
    if ((method === 'programNotification' || method === 'accountNotification') && result) {
      const slot = Number(result.context?.slot || 0);
      const value = result.value || {};
      const pubkey = typeof value.pubkey === 'string' ? value.pubkey : result.pubkey || '';
      const account = value.account || result.account || {};
      const owner = typeof account.owner === 'string' ? account.owner : '';
      const lamports = Number(account.lamports || 0);

      const eventId = this.generateEventId('HELIUS_WSS', 'ACCOUNT_UPDATE', slot, undefined, pubkey);

      return {
        eventId,
        source: 'HELIUS_WSS',
        transport: 'wss',
        network,
        slot,
        signature: `acc_${pubkey.slice(0, 8)}_${slot}`,
        timestamp: now,
        receivedAt: now,
        type: 'ACCOUNT_UPDATE',
        mint: pubkey,
        owner,
        accountKeys: pubkey ? [pubkey] : [],
        raw: msg,
      };
    }

    // 4. Signature Notification (Confirmation)
    if (method === 'signatureNotification' && result) {
      const slot = Number(result.context?.slot || 0);
      const value = result.value || {};
      const err = value.err || null;
      const signature = msg.signature || `sig_conf_${slot}`;

      const eventId = this.generateEventId('HELIUS_WSS', 'SIGNATURE_CONFIRMED', slot, signature);

      return {
        eventId,
        source: 'HELIUS_WSS',
        transport: 'wss',
        network,
        slot,
        signature,
        timestamp: now,
        receivedAt: now,
        type: 'ON_CHAIN_TX',
        err,
        raw: msg,
      };
    }

    return null;
  }

  /**
   * Helper to encode binary data to Base58 string.
   */
  public static toBase58(val: unknown): string {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (Buffer.isBuffer(val) || val instanceof Uint8Array || Array.isArray(val)) {
      try {
        return bs58.encode(Uint8Array.from(val));
      } catch {
        return Buffer.from(val as any).toString('hex');
      }
    }
    return String(val);
  }
}
