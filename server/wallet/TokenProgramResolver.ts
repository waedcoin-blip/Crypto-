// server/wallet/TokenProgramResolver.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { getPrimaryRpc } from '../config/rpcRouting.js';
import { logger } from '../utils/logger.js';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export interface TokenProgramInfo {
  mint: string;
  program: 'SPL Token' | 'Token-2022' | 'Unknown';
  programId: string;
  decimals: number;
  supply: string;
  isInitialized: boolean;
  freezeAuthority: string | null;
  mintAuthority: string | null;
  resolvedAt: number;
}

/**
 * TokenProgramResolver: Resolves token program type and metadata.
 * Detects SPL Token vs Token-2022 and extracts decimals.
 * Uses caching to avoid redundant RPC calls.
 */
export class TokenProgramResolver {
  private static instance: TokenProgramResolver;
  private cache: Map<string, { info: TokenProgramInfo; expiresAt: number }> = new Map();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  private constructor() {
    // Periodic cache pruning
    const interval = setInterval(() => this.pruneCache(), 60000);
    if (interval.unref) interval.unref();
  }

  public static getInstance(): TokenProgramResolver {
    if (!TokenProgramResolver.instance) {
      TokenProgramResolver.instance = new TokenProgramResolver();
    }
    return TokenProgramResolver.instance;
  }

  /**
   * Resolve token program info for a mint address.
   */
  public async resolve(connection: Connection | null, mint: string): Promise<TokenProgramInfo> {
    const trimmed = mint.trim();

    // Check cache first
    const cached = this.cache.get(trimmed);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.info;
    }

    // Resolve on-chain
    const info = await this.resolveOnChain(connection, trimmed);

    // Cache the result
    this.cache.set(trimmed, {
      info,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    return info;
  }

  private async resolveOnChain(connection: Connection | null, mint: string): Promise<TokenProgramInfo> {
    const fallback: TokenProgramInfo = {
      mint,
      program: 'Unknown',
      programId: TOKEN_PROGRAM_ID,
      decimals: 6,
      supply: '0',
      isInitialized: false,
      freezeAuthority: null,
      mintAuthority: null,
      resolvedAt: Date.now(),
    };

    try {
      const conn = connection || await this.getConnection();
      if (!conn) {
        logger.warn({ mint }, '[TokenProgramResolver] No RPC connection available');
        return fallback;
      }

      const pubkey = new PublicKey(mint);
      const accountInfo = await conn.getAccountInfo(pubkey, 'confirmed');

      if (!accountInfo) {
        return fallback;
      }

      const ownerStr = accountInfo.owner.toBase58();
      const isSPL = ownerStr === TOKEN_PROGRAM_ID;
      const isToken2022 = ownerStr === TOKEN_2022_PROGRAM_ID;

      if (!isSPL && !isToken2022) {
        return { ...fallback, program: 'Unknown', programId: ownerStr };
      }

      // Parse mint account data
      // SPL Token mint layout:
      // - bytes 0-3: mintAuthorityOption (4 bytes)
      // - bytes 4-35: mintAuthority (32 bytes)
      // - bytes 36-43: supply (8 bytes, u64)
      // - byte 44: decimals (1 byte)
      // - byte 45: isInitialized (1 byte)
      // - bytes 46-49: freezeAuthorityOption (4 bytes)
      // - bytes 50-81: freezeAuthority (32 bytes)

      let decimals = 6;
      let supply = '0';
      let isInitialized = false;
      let freezeAuthority: string | null = null;
      let mintAuthority: string | null = null;

      try {
        if (accountInfo.data && accountInfo.data.length >= 82) {
          const data = accountInfo.data;

          // Mint authority (bytes 4-35, if option at 0-3 is 1)
          const mintAuthOption = data.readUInt32LE(0);
          if (mintAuthOption === 1) {
            mintAuthority = new PublicKey(data.slice(4, 36)).toBase58();
          }

          // Supply (bytes 36-43)
          supply = data.readBigUInt64LE(36).toString();

          // Decimals (byte 44)
          decimals = data.readUInt8(44);

          // Is initialized (byte 45)
          isInitialized = data.readUInt8(45) === 1;

          // Freeze authority (bytes 50-81, if option at 46-49 is 1)
          const freezeAuthOption = data.readUInt32LE(46);
          if (freezeAuthOption === 1) {
            freezeAuthority = new PublicKey(data.slice(50, 82)).toBase58();
          }
        }
      } catch (parseErr: any) {
        logger.warn({ mint, error: parseErr.message }, '[TokenProgramResolver] Failed to parse mint data, using defaults');
      }

      return {
        mint,
        program: isToken2022 ? 'Token-2022' : 'SPL Token',
        programId: ownerStr,
        decimals,
        supply,
        isInitialized,
        freezeAuthority,
        mintAuthority,
        resolvedAt: Date.now(),
      };
    } catch (err: any) {
      logger.error({ mint, error: err.message }, '[TokenProgramResolver] On-chain resolution failed');
      return fallback;
    }
  }

  /**
   * Quick decimals lookup (most common use case).
   */
  public async resolveDecimals(mint: string): Promise<number> {
    try {
      const info = await this.resolve(null, mint);
      return info.decimals;
    } catch {
      return 6; // Default fallback
    }
  }

  /**
   * Check if a mint is a Token-2022 program token.
   */
  public async isToken2022(mint: string): Promise<boolean> {
    try {
      const info = await this.resolve(null, mint);
      return info.program === 'Token-2022';
    } catch {
      return false;
    }
  }

  private async getConnection(): Promise<Connection | null> {
    try {
      const rpcUrl = getPrimaryRpc('search');
      if (!rpcUrl) return null;
      return new Connection(rpcUrl, 'confirmed');
    } catch {
      return null;
    }
  }

  private pruneCache(): void {
    const now = Date.now();
    let pruned = 0;
    for (const [key, val] of this.cache.entries()) {
      if (now > val.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) {
      logger.debug({ pruned }, '[TokenProgramResolver] Pruned expired cache entries');
    }
  }
}

export const tokenProgramResolver = TokenProgramResolver.getInstance();
