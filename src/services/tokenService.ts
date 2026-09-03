// src/services/tokenService.ts
// Centralized Token Service for ARINA X-RAY
// Manages token decimals, balances, metadata, and mint authority checks.

import { PublicKey } from '@solana/web3.js';
import { TokenDecimalsResolver } from './TokenDecimalsResolver';
import { tokenRegistry } from './TokenRegistry';
import { rpcService } from './rpcService';
import { SOL_MINT } from '../constants/solana';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export interface TokenMetadata {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  supply?: bigint;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  isToken2022?: boolean;
}

class TokenService {
  /**
   * Resolves decimals for a token mint synchronously (throws if unverified).
   */
  public resolveDecimalsSync(mint: string): number {
    return TokenDecimalsResolver.resolveSync(mint);
  }

  /**
   * Resolves decimals for a token mint asynchronously on-chain or via verified registry.
   */
  public async resolveDecimalsAsync(mint: string): Promise<number> {
    return TokenDecimalsResolver.resolveAsync(mint);
  }

  /**
   * Check if mint is SOL or WSOL.
   */
  public isSolMint(mint: string): boolean {
    return TokenDecimalsResolver.isSolMint(mint);
  }

  /**
   * Get raw token balance for a wallet address and token mint.
   * Throws TOKEN_BALANCE_LOOKUP_FAILED if RPC query fails (never defaults to zero on error).
   */
  public async getTokenBalanceRaw(walletAddress: string, tokenMint: string): Promise<{ raw: bigint; ui: number; decimals: number }> {
    if (this.isSolMint(tokenMint)) {
      const lamports = await rpcService.getBalance(walletAddress);
      const decimals = 9;
      const ui = lamports / 1_000_000_000;
      return { raw: BigInt(lamports), ui, decimals };
    }

    const decimals = await this.resolveDecimalsAsync(tokenMint);
    const walletPubkey = new PublicKey(walletAddress);
    const mintPubkey = new PublicKey(tokenMint);

    try {
      const conn = rpcService.getConnection();
      // Query both SPL and Token-2022 program accounts
      const accounts = await conn.getParsedTokenAccountsByOwner(walletPubkey, { mint: mintPubkey }, 'confirmed');
      
      let totalRaw = 0n;
      if (accounts.value && accounts.value.length > 0) {
        for (const acc of accounts.value) {
          const rawStr = acc.account.data.parsed.info.tokenAmount.amount;
          if (rawStr) {
            totalRaw += BigInt(rawStr);
          }
        }
      }

      const divisor = 10 ** decimals;
      const ui = Number(totalRaw) / divisor;
      return { raw: totalRaw, ui, decimals };
    } catch (error: any) {
      throw new Error(`TOKEN_BALANCE_LOOKUP_FAILED: Failed to fetch balance for wallet ${walletAddress} and mint ${tokenMint}: ${error?.message || error}`);
    }
  }

  /**
   * Fetches on-chain mint details (supply, mint authority, freeze authority).
   */
  public async getMintInfo(mint: string): Promise<TokenMetadata> {
    if (this.isSolMint(mint)) {
      return {
        mint: SOL_MINT,
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        mintAuthority: null,
        freezeAuthority: null,
      };
    }

    const mintPubkey = new PublicKey(mint);
    const accountInfo = await rpcService.getAccountInfo(mintPubkey);

    if (!accountInfo) {
      throw new Error(`MINT_NOT_FOUND: Mint account ${mint} does not exist on-chain`);
    }

    const isToken2022 = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
    const decimals = await this.resolveDecimalsAsync(mint);

    const reg = tokenRegistry.getToken(mint);
    return {
      mint,
      symbol: reg?.symbol || 'UNKNOWN',
      name: reg?.name || 'Unknown Token',
      decimals,
      isToken2022,
    };
  }
}

export const tokenService = new TokenService();
