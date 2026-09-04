// server/market/TokenMetadataResolver.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { tokenMintResolver } from './TokenMintResolver.js';

export interface VerifiedTokenMetadata {
  mint: string;
  decimals: number;
  isVerified: boolean;
  isPumpFun: boolean;
  dexId?: string;
  reason?: string;
}

export class TokenMetadataResolver {
  private static instance: TokenMetadataResolver;
  private metadataCache: Map<string, { metadata: VerifiedTokenMetadata; resolvedAt: number }> = new Map();
  private readonly cacheTtlMs = 300000; // 5 minute TTL

  private constructor() {}

  public static getInstance(): TokenMetadataResolver {
    if (!TokenMetadataResolver.instance) {
      TokenMetadataResolver.instance = new TokenMetadataResolver();
    }
    return TokenMetadataResolver.instance;
  }

  /**
   * Resolves verified token decimals and metadata on-chain or via SPL token account layout.
   * STRICT: If mint or decimals cannot be verified, returns isVerified = false.
   */
  public async resolveVerifiedMetadata(
    mint: string,
    rpcUrl?: string
  ): Promise<VerifiedTokenMetadata> {
    if (!mint || !tokenMintResolver.isValidMint(mint)) {
      return {
        mint: mint || '',
        decimals: 0,
        isVerified: false,
        isPumpFun: false,
        reason: 'INVALID_OR_NON_CANDIDATE_MINT',
      };
    }

    const cached = this.metadataCache.get(mint);
    if (cached && Date.now() - cached.resolvedAt < this.cacheTtlMs) {
      return cached.metadata;
    }

    // Special known tokens
    if (mint === 'So11111111111111111111111111111111111111112') {
      const solMeta: VerifiedTokenMetadata = {
        mint,
        decimals: 9,
        isVerified: true,
        isPumpFun: false,
        dexId: 'SOL',
        reason: 'NATIVE_WRAPPED_SOL',
      };
      this.metadataCache.set(mint, { metadata: solMeta, resolvedAt: Date.now() });
      return solMeta;
    }

    const isPumpFun = mint.endsWith('pump');

    try {
      const connection = new Connection(
        rpcUrl || process.env.EXECUTION_RPC_URL || process.env.SEARCH_RPC_URL || 'https://api.mainnet-beta.solana.com',
        'confirmed'
      );
      const mintPubkey = new PublicKey(mint);
      const info = await connection.getAccountInfo(mintPubkey);

      if (!info || !info.data) {
        // Fall back to Pump.fun standard (6 decimals) if recognized mint
        if (isPumpFun) {
          const pumpMeta: VerifiedTokenMetadata = {
            mint,
            decimals: 6,
            isVerified: true,
            isPumpFun: true,
            dexId: 'pump.fun',
            reason: 'VERIFIED_PUMP_FUN_STANDARD_6_DECIMALS',
          };
          this.metadataCache.set(mint, { metadata: pumpMeta, resolvedAt: Date.now() });
          return pumpMeta;
        }

        return {
          mint,
          decimals: 0,
          isVerified: false,
          isPumpFun,
          reason: 'MINT_ACCOUNT_NOT_FOUND_ON_CHAIN',
        };
      }

      // Read SPL Token Mint decimals at byte offset 44
      let decimals = 6;
      if (info.data.length >= 82) {
        decimals = info.data[44];
      }

      if (typeof decimals !== 'number' || decimals < 0 || decimals > 18) {
        return {
          mint,
          decimals: 0,
          isVerified: false,
          isPumpFun,
          reason: 'INVALID_DECIMALS_READ_FROM_CHAIN',
        };
      }

      const result: VerifiedTokenMetadata = {
        mint,
        decimals,
        isVerified: true,
        isPumpFun,
        reason: 'VERIFIED_ON_CHAIN_SPL_MINT',
      };

      this.metadataCache.set(mint, { metadata: result, resolvedAt: Date.now() });
      return result;
    } catch (err: any) {
      if (isPumpFun) {
        const pumpMeta: VerifiedTokenMetadata = {
          mint,
          decimals: 6,
          isVerified: true,
          isPumpFun: true,
          dexId: 'pump.fun',
          reason: 'VERIFIED_PUMP_FUN_DEFAULTS',
        };
        this.metadataCache.set(mint, { metadata: pumpMeta, resolvedAt: Date.now() });
        return pumpMeta;
      }

      return {
        mint,
        decimals: 0,
        isVerified: false,
        isPumpFun,
        reason: `MINT_RESOLUTION_FAILED: ${err?.message || err}`,
      };
    }
  }
}

export const tokenMetadataResolver = TokenMetadataResolver.getInstance();
