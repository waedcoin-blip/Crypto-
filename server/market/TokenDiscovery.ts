// server/market/TokenDiscovery.ts
import { tokenRepository } from '../repositories/TokenRepository.js';
import { MarketEvent } from './EventNormalizer.js';
import { tokenMintResolver } from './TokenMintResolver.js';

export class TokenDiscovery {
  private static instance: TokenDiscovery;

  private constructor() {}

  public static getInstance(): TokenDiscovery {
    if (!TokenDiscovery.instance) {
      TokenDiscovery.instance = new TokenDiscovery();
    }
    return TokenDiscovery.instance;
  }

  public processMarketEvent(event: MarketEvent): void {
    if (event.type !== 'ON_CHAIN_TX' || !event.accountKeys) return;

    for (const key of event.accountKeys) {
      if (!this.isValidMintCandidate(key)) continue;

      const existing = tokenRepository.getToken(key);
      tokenRepository.upsertToken({
        mintAddress: key,
        network: event.network || 'mainnet',
        discoveredAt: existing?.discoveredAt ?? event.timestamp,
        updatedAt: event.timestamp,
        signal: existing?.signal ?? 'HELIUS_WSS_DISCOVERY',
        metadata: {
          ...(existing?.metadata || {}),
          lastSignature: event.signature,
          lastSlot: event.slot,
        },
      });
    }
  }

  public isValidMintCandidate(address: string): boolean {
    return tokenMintResolver.isValidMint(address);
  }
}

export const tokenDiscovery = TokenDiscovery.getInstance();
