// server/market/TokenDiscovery.ts
import { SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { tokenRepository } from '../repositories/TokenRepository.js';
import { MarketEvent } from './EventNormalizer.js';

const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111';
const RENT_SYSVAR_ID = 'SysvarRent111111111111111111111111111111';

const KNOWN_NON_MINTS = new Set<string>([
  SystemProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID,
  WSOL_MINT,
  COMPUTE_BUDGET_PROGRAM_ID,
  RENT_SYSVAR_ID,
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter
]);

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
        signal: existing?.signal ?? 'YELLOWSTONE_GRPC_DISCOVERY',
        metadata: {
          ...(existing?.metadata || {}),
          lastSignature: event.signature,
          lastSlot: event.slot,
        },
      });
    }
  }

  public isValidMintCandidate(address: string): boolean {
    if (!address || typeof address !== 'string') return false;
    if (address.length < 32 || address.length > 44) return false;
    if (KNOWN_NON_MINTS.has(address)) return false;
    return true;
  }
}

export const tokenDiscovery = TokenDiscovery.getInstance();
