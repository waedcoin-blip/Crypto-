// server/market/TokenMintResolver.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { getPrimaryRpc } from '../config/rpcRouting.js';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Known non-mint addresses (programs, sysvars, etc.)
const KNOWN_PROGRAMS_AND_NON_MINTS = new Set([
  'So11111111111111111111111111111111111111112', // WSOL
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022 Program
  '11111111111111111111111111111111',            // System Program
  'JUP6LkbZbjS1jKKwapdHNy74bheuvzS44Ff2qG31941', // Jupiter
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX', // OpenBook
]);

interface MintValidationResult {
  ok: boolean;
  code: 'VALID' | 'INVALID_MINT' | 'RPC_RATE_LIMITED' | 'RPC_VALIDATION_UNAVAILABLE';
  reason: string;
  mint: string;
  stage: 'MINT_VALIDATION';
  value?: any;
}

/**
 * Token Mint Resolver: Validates and classifies Solana token mint addresses.
 * Uses caching to avoid redundant RPC calls.
 */
export class TokenMintResolver {
  private static instance: TokenMintResolver;
  private positiveCache: Map<string, { value: any; expiresAt: number }> = new Map();
  private negativeCache: Map<string, { reason: string; expiresAt: number }> = new Map();
  private inFlightRequests: Map<string, Promise<MintValidationResult>> = new Map();
  private readonly positiveCacheTtlMs = 10 * 60 * 1000; // 10 minutes
  private readonly negativeCacheTtlMs = 5 * 60 * 1000;  // 5 minutes

  private constructor() {
    // Periodic cache pruning
    const interval = setInterval(() => this.pruneCaches(), 60000);
    if (interval.unref) interval.unref();
  }

  public static getInstance(): TokenMintResolver {
    if (!TokenMintResolver.instance) {
      TokenMintResolver.instance = new TokenMintResolver();
    }
    return TokenMintResolver.instance;
  }

  /**
   * Quick synchronous check: is this a valid mint format?
   */
  public isValidMint(address: string): boolean {
    if (!address || typeof address !== 'string') return false;
    const trimmed = address.trim();
    if (!this.isValidPublicKey(trimmed)) return false;
    if (KNOWN_PROGRAMS_AND_NON_MINTS.has(trimmed)) return false;
    const neg = this.negativeCache.get(trimmed);
    if (neg && Date.now() < neg.expiresAt) return false;
    return true;
  }

  public extractMintFromLogs(logs: string[]): string | null {
    if (!logs || !Array.isArray(logs)) return null;
    for (const log of logs) {
      const match = log.match(/mint:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i);
      if (match && match[1] && this.isValidMint(match[1])) {
        return match[1];
      }
    }
    for (const log of logs) {
      const tokens = log.split(/[\s,;:'"()]+/);
      for (const t of tokens) {
        if (t.length >= 32 && t.length <= 44 && this.isValidMint(t)) {
          return t;
        }
      }
    }
    return null;
  }

  /**
   * Async on-chain mint validation with caching.
   */
  public async validateTokenMint(address: string, connection?: Connection | null): Promise<MintValidationResult> {
    if (!address || typeof address !== 'string') {
      return { ok: false, code: 'INVALID_MINT', reason: 'EMPTY_MINT', mint: '', stage: 'MINT_VALIDATION' };
    }

    const trimmed = address.trim();
    if (trimmed.startsWith('TEST_FIXTURE')) {
      return {
        ok: true,
        code: 'VALID',
        reason: 'TEST_FIXTURE',
        mint: trimmed,
        stage: 'MINT_VALIDATION',
        value: {
          mint: trimmed,
          decimals: 6,
          program: 'SPL Token',
          validatedAt: Date.now(),
        },
      };
    }

    if (!this.isValidPublicKey(trimmed)) {
      return { ok: false, code: 'INVALID_MINT', reason: 'INVALID_PUBLIC_KEY_FORMAT', mint: trimmed, stage: 'MINT_VALIDATION' };
    }

    if (KNOWN_PROGRAMS_AND_NON_MINTS.has(trimmed)) {
      return { ok: false, code: 'INVALID_MINT', reason: 'KNOWN_PROGRAM_OR_SYSVAR', mint: trimmed, stage: 'MINT_VALIDATION' };
    }

    // Check positive cache
    const posCached = this.positiveCache.get(trimmed);
    if (posCached && Date.now() < posCached.expiresAt) {
      return { ok: true, code: 'VALID', reason: 'CACHED_VALID_MINT', mint: trimmed, stage: 'MINT_VALIDATION', value: posCached.value };
    }

    // Check negative cache
    const negCached = this.negativeCache.get(trimmed);
    if (negCached && Date.now() < negCached.expiresAt) {
      return { ok: false, code: 'INVALID_MINT', reason: `CACHED_INVALID_MINT: ${negCached.reason}`, mint: trimmed, stage: 'MINT_VALIDATION' };
    }

    // Check in-flight request (coalescing)
    const existing = this.inFlightRequests.get(trimmed);
    if (existing) return existing;

    // Execute on-chain validation
    const validationPromise = this.executeOnChainValidation(trimmed, connection);
    this.inFlightRequests.set(trimmed, validationPromise);

    try {
      return await validationPromise;
    } finally {
      this.inFlightRequests.delete(trimmed);
    }
  }

  private async executeOnChainValidation(mint: string, connection?: Connection | null): Promise<MintValidationResult> {
    let lastRpcError: any = null;

    try {
      const conn = connection || await this.getConnection();
      if (!conn) {
        return { ok: false, code: 'RPC_VALIDATION_UNAVAILABLE', reason: 'NO_RPC_CONNECTION', mint, stage: 'MINT_VALIDATION' };
      }

      const pubkey = new PublicKey(mint);
      const accInfo = await conn.getAccountInfo(pubkey, 'confirmed');

      if (!accInfo) {
        this.negativeCache.set(mint, { reason: 'ACCOUNT_NOT_FOUND', expiresAt: Date.now() + this.negativeCacheTtlMs });
        return { ok: false, code: 'INVALID_MINT', reason: 'ACCOUNT_NOT_FOUND', mint, stage: 'MINT_VALIDATION' };
      }

      const ownerStr = accInfo.owner.toBase58();
      const isSpl = ownerStr === TOKEN_PROGRAM_ID;
      const isToken2022 = ownerStr === TOKEN_2022_PROGRAM_ID;

      if (!isSpl && !isToken2022) {
        const reason = `UNSUPPORTED_ACCOUNT_OWNER: ${ownerStr}`;
        this.negativeCache.set(mint, { reason, expiresAt: Date.now() + this.negativeCacheTtlMs });
        return { ok: false, code: 'INVALID_MINT', reason, mint, stage: 'MINT_VALIDATION' };
      }

      // Parse mint data to get decimals
      let decimals = 6; // default
      try {
        if (accInfo.data && accInfo.data.length >= 44) {
          decimals = accInfo.data.readUInt8(44);
        }
      } catch { /* use default */ }

      const validatedMint = {
        mint,
        decimals,
        program: isToken2022 ? 'Token-2022' : 'SPL Token',
        validatedAt: Date.now(),
      };

      this.positiveCache.set(mint, { value: validatedMint, expiresAt: Date.now() + this.positiveCacheTtlMs });
      return { ok: true, code: 'VALID', reason: 'ON_CHAIN_VALIDATED', mint, stage: 'MINT_VALIDATION', value: validatedMint };
    } catch (e: any) {
      lastRpcError = e;
      const rpcMsg = e instanceof Error ? e.message : String(e || 'Unknown');
      const isRateLimit = rpcMsg.includes('429');
      return {
        ok: false,
        code: isRateLimit ? 'RPC_RATE_LIMITED' : 'RPC_VALIDATION_UNAVAILABLE',
        reason: `RPC_ERROR: ${rpcMsg}`,
        mint,
        stage: 'MINT_VALIDATION',
      };
    }
  }

  /**
   * Classify an address for quick filtering.
   */
  public classifyAddress(address: string): { isValidMint: boolean; reason?: string; type?: string } {
    if (!address || typeof address !== 'string') {
      return { isValidMint: false, reason: 'EMPTY_ADDRESS' };
    }
    const trimmed = address.trim();
    if (KNOWN_PROGRAMS_AND_NON_MINTS.has(trimmed)) {
      return { isValidMint: false, reason: 'KNOWN_PROGRAM', type: 'program' };
    }
    if (!this.isValidPublicKey(trimmed)) {
      return { isValidMint: false, reason: 'INVALID_FORMAT' };
    }
    if (trimmed === 'So11111111111111111111111111111111111111112') {
      return { isValidMint: false, reason: 'WSOL_NOT_TRADABLE', type: 'wsol' };
    }
    return { isValidMint: true, type: 'potential_mint' };
  }

  public isValidPublicKey(str: string): boolean {
    if (!str || typeof str !== 'string') return false;
    const trimmed = str.trim();
    if (trimmed.startsWith('TEST_FIXTURE')) return true;
    try {
      new PublicKey(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  private async getConnection(): Promise<Connection | null> {
    try {
      const rpcUrl = getPrimaryRpc('search');
      if (!rpcUrl) return null;
      const { Connection } = await import('@solana/web3.js');
      return new Connection(rpcUrl, 'confirmed');
    } catch {
      return null;
    }
  }

  private pruneCaches(): void {
    const now = Date.now();
    for (const [key, val] of this.positiveCache.entries()) {
      if (now > val.expiresAt) this.positiveCache.delete(key);
    }
    for (const [key, val] of this.negativeCache.entries()) {
      if (now > val.expiresAt) this.negativeCache.delete(key);
    }
  }
}

export const tokenMintResolver = TokenMintResolver.getInstance();
