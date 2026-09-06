// server/market/TokenMintResolver.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, unpackMint } from '@solana/spl-token';
import bs58 from 'bs58';
import { validateSolanaMint } from '../../src/utils/solanaValidators.js';

export type AddressClassification =
  | 'TOKEN_MINT'
  | 'PROGRAM_ID'
  | 'WALLET'
  | 'PDA'
  | 'POOL'
  | 'SYSTEM_SYSVAR'
  | 'UNKNOWN';

export interface ResolvedMintResult {
  mint: string;
  classification: AddressClassification;
  isValidMint: boolean;
  reason: string;
}

export interface CanonicalValidatedMint {
  mint: string;
  ownerProgramId: string;
  programName: 'spl-token' | 'token-2022';
  decimals: number;
  supply: string;
  isInitialized: boolean;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  validatedAt: number;
}

export type ValidationErrorCode =
  | 'VALID'
  | 'INVALID_MINT'
  | 'RPC_VALIDATION_UNAVAILABLE'
  | 'RPC_RATE_LIMITED'
  | 'RPC_ERROR';

export interface MintValidationResult {
  ok: boolean;
  code: ValidationErrorCode;
  reason: string;
  mint: string;
  stage: 'MINT_VALIDATION';
  value?: CanonicalValidatedMint;
}

// Exhaustive set of known Solana System, Program, DEX, and Router addresses that must NEVER be treated as token mints.
const KNOWN_PROGRAMS_AND_NON_MINTS = new Set<string>([
  // Solana System & Core Programs
  '11111111111111111111111111111111', // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022 Program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Account Program
  'ComputeBudget111111111111111111111111111', // Compute Budget Program
  'SysvarRent111111111111111111111111111111', // Rent Sysvar
  'SysvarC1ock11111111111111111111111111111111', // Clock Sysvar
  'SysvarRecentB1ockHashes11111111111111111111', // Recent Blockhashes Sysvar
  'SysvarS1otHashes111111111111111111111111111', // Slot Hashes Sysvar
  'SysvarEpochRewards1111111111111111111111111', // Epoch Rewards Sysvar
  'SysvarFees111111111111111111111111111111111', // Fees Sysvar
  'SysvarStakeHistory1111111111111111111111111', // Stake History Sysvar
  'SysvarLastRestartS1ot1111111111111111111111', // Last Restart Slot Sysvar
  'AddressLookupTab1e1111111111111111111111111', // Address Lookup Table Program
  'Config1111111111111111111111111111111111111', // Config Program
  'Stake11111111111111111111111111111111111111', // Stake Program
  'Vote111111111111111111111111111111111111111', // Vote Program
  'BPFLoaderUpgradeab1e11111111111111111111111', // BPF Upgradeable Loader
  'BPFLoader2111111111111111111111111111111111', // BPF Loader 2
  'BPFLoader1111111111111111111111111111111111', // BPF Loader 1
  'Ed25519SigVerify111111111111111111111111111', // Ed25519 Sig Verify
  'KeccakSecp256k11111111111111111111111111111', // Keccak Secp256k1 Verify

  // Major DEX Programs
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun Program
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', // Raydium CPMM
  'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS', // Raydium Routing
  '5quBtoiQqxF9Jv6KYqWNxugsquDnFTxpJv3QfueDXRpp', // Raydium Pool Authority
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6 Aggregator
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter v4
  'DCA265Vj8a9CEuX1eb1LWRnDT7uK6qNaVmW7Ah294EC5', // Jupiter DCA
  'jup3FDtHk4f5kS5efmH4yZqKzR9gBv4g9tYvVw8vR5k', // Jupiter Limit Orders
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca v2
  'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1', // Orca v1
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora DLMM
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', // Meteora Dynamic Pools
  '24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHm2Yoj3nh25b3UG', // Meteora Vaults
  'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY', // Phoenix DEX
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX', // OpenBook v1
  'opnb2LAXJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb', // OpenBook v2
  'MSHOT11111111111111111111111111111111111111', // Moonshot Program
  'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG', // Moonshot Core

  // Pump.fun Global Authorities, Fee Recipients & System PDAs
  '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf', // Pump.fun Global Authority
  'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', // Pump.fun Fee Recipient
  'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1', // Pump.fun Mint Authority
]);

export class TokenMintResolver {
  private static instance: TokenMintResolver;
  private positiveCache: Map<string, { value: CanonicalValidatedMint; expiresAt: number }> = new Map();
  private negativeCache: Map<string, { reason: string; expiresAt: number }> = new Map();
  private inFlightRequests: Map<string, Promise<MintValidationResult>> = new Map();

  private readonly positiveCacheTtlMs = 600000; // 10 minutes
  private readonly negativeCacheTtlMs = 300000; // 5 minutes

  private constructor() {}

  public static getInstance(): TokenMintResolver {
    if (!TokenMintResolver.instance) {
      TokenMintResolver.instance = new TokenMintResolver();
    }
    return TokenMintResolver.instance;
  }

  /**
   * Validates if a given string is a syntactically valid Solana PublicKey (Base58, 32-byte).
   */
  public isValidPublicKey(address: string): boolean {
    return validateSolanaMint(address).valid;
  }

  /**
   * Authoritative, canonical on-chain token mint validation.
   * Verifies Base58 syntax, program IDs, on-chain account existence, owner program, and SPL / Token-2022 layout.
   */
  public async validateTokenMint(
    address: string,
    connection?: Connection | null,
    options?: { forceRefresh?: boolean; timeoutMs?: number }
  ): Promise<MintValidationResult> {
    if (!address || typeof address !== 'string') {
      return {
        ok: false,
        code: 'INVALID_MINT',
        reason: 'EMPTY_OR_NON_STRING_ADDRESS',
        mint: '',
        stage: 'MINT_VALIDATION',
      };
    }

    const trimmed = address.trim();

    if (!this.isValidPublicKey(trimmed)) {
      return {
        ok: false,
        code: 'INVALID_MINT',
        reason: 'INVALID_BASE58_OR_BYTE_LENGTH',
        mint: trimmed,
        stage: 'MINT_VALIDATION',
      };
    }

    if (KNOWN_PROGRAMS_AND_NON_MINTS.has(trimmed)) {
      return {
        ok: false,
        code: 'INVALID_MINT',
        reason: 'KNOWN_PROGRAM_OR_SYSVAR',
        mint: trimmed,
        stage: 'MINT_VALIDATION',
      };
    }

    if (!options?.forceRefresh) {
      const posCached = this.positiveCache.get(trimmed);
      if (posCached && Date.now() < posCached.expiresAt) {
        return {
          ok: true,
          code: 'VALID',
          reason: 'CACHED_VALID_MINT',
          mint: trimmed,
          stage: 'MINT_VALIDATION',
          value: posCached.value,
        };
      }

      const negCached = this.negativeCache.get(trimmed);
      if (negCached && Date.now() < negCached.expiresAt) {
        return {
          ok: false,
          code: 'INVALID_MINT',
          reason: `CACHED_INVALID_MINT: ${negCached.reason}`,
          mint: trimmed,
          stage: 'MINT_VALIDATION',
        };
      }
    }

    if (this.inFlightRequests.has(trimmed)) {
      return await this.inFlightRequests.get(trimmed)!;
    }

    const validationPromise = (async (): Promise<MintValidationResult> => {
      try {
        let pubkey: PublicKey;
        try {
          pubkey = new PublicKey(trimmed);
        } catch {
          return {
            ok: false,
            code: 'INVALID_MINT',
            reason: 'INVALID_PUBLIC_KEY',
            mint: trimmed,
            stage: 'MINT_VALIDATION',
          };
        }

        const connList = connection ? [connection] : this.getRpcConnections();
        if (!connList.length) {
          return {
            ok: false,
            code: 'RPC_VALIDATION_UNAVAILABLE',
            reason: 'NO_RPC_ENDPOINTS_CONFIGURED',
            mint: trimmed,
            stage: 'MINT_VALIDATION',
          };
        }

        let lastRpcError: unknown = null;
        for (let i = 0; i < connList.length; i++) {
          const conn = connList[i];
          try {
            const timeoutMs = options?.timeoutMs || 4000;
            const accInfo = await Promise.race([
              conn.getAccountInfo(pubkey, 'confirmed'),
              new Promise<null>((_, reject) => setTimeout(() => reject(new Error('RPC_TIMEOUT')), timeoutMs)),
            ]);

            if (!accInfo) {
              const reason = 'ACCOUNT_DOES_NOT_EXIST';
              this.negativeCache.set(trimmed, { reason, expiresAt: Date.now() + this.negativeCacheTtlMs });
              this.logValidationEvent(trimmed, 'INVALID', reason, null);
              return {
                ok: false,
                code: 'INVALID_MINT',
                reason,
                mint: trimmed,
                stage: 'MINT_VALIDATION',
              };
            }

            if (accInfo.executable) {
              const reason = 'EXECUTABLE_PROGRAM_ACCOUNT';
              this.negativeCache.set(trimmed, { reason, expiresAt: Date.now() + this.negativeCacheTtlMs });
              this.logValidationEvent(trimmed, 'INVALID', reason, null);
              return {
                ok: false,
                code: 'INVALID_MINT',
                reason,
                mint: trimmed,
                stage: 'MINT_VALIDATION',
              };
            }

            const ownerStr = accInfo.owner.toBase58();
            const isSpl = ownerStr === TOKEN_PROGRAM_ID.toBase58();
            const isToken2022 = ownerStr === TOKEN_2022_PROGRAM_ID.toBase58();

            if (!isSpl && !isToken2022) {
              const reason = `UNSUPPORTED_ACCOUNT_OWNER: ${ownerStr}`;
              this.negativeCache.set(trimmed, { reason, expiresAt: Date.now() + this.negativeCacheTtlMs });
              this.logValidationEvent(trimmed, 'INVALID', reason, ownerStr);
              return {
                ok: false,
                code: 'INVALID_MINT',
                reason,
                mint: trimmed,
                stage: 'MINT_VALIDATION',
              };
            }

            const programId = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
            let mintData;
            try {
              mintData = unpackMint(pubkey, accInfo, programId);
            } catch (e: any) {
              const reason = `NOT_A_MINT_ACCOUNT: ${e?.message || 'Data layout mismatch'}`;
              this.negativeCache.set(trimmed, { reason, expiresAt: Date.now() + this.negativeCacheTtlMs });
              this.logValidationEvent(trimmed, 'INVALID', reason, ownerStr);
              return {
                ok: false,
                code: 'INVALID_MINT',
                reason,
                mint: trimmed,
                stage: 'MINT_VALIDATION',
              };
            }

            if (!mintData.isInitialized) {
              const reason = 'MINT_NOT_INITIALIZED';
              this.negativeCache.set(trimmed, { reason, expiresAt: Date.now() + this.negativeCacheTtlMs });
              this.logValidationEvent(trimmed, 'INVALID', reason, ownerStr);
              return {
                ok: false,
                code: 'INVALID_MINT',
                reason,
                mint: trimmed,
                stage: 'MINT_VALIDATION',
              };
            }

            const validatedMint: CanonicalValidatedMint = {
              mint: trimmed,
              ownerProgramId: ownerStr,
              programName: isToken2022 ? 'token-2022' : 'spl-token',
              decimals: mintData.decimals,
              supply: mintData.supply ? mintData.supply.toString() : '0',
              isInitialized: mintData.isInitialized,
              mintAuthority: mintData.mintAuthority ? mintData.mintAuthority.toBase58() : null,
              freezeAuthority: mintData.freezeAuthority ? mintData.freezeAuthority.toBase58() : null,
              validatedAt: Date.now(),
            };

            this.positiveCache.set(trimmed, { value: validatedMint, expiresAt: Date.now() + this.positiveCacheTtlMs });
            this.logValidationEvent(trimmed, 'VALID', 'ON_CHAIN_VALIDATED', ownerStr, validatedMint.decimals);

            return {
              ok: true,
              code: 'VALID',
              reason: 'ON_CHAIN_VALIDATED',
              mint: trimmed,
              stage: 'MINT_VALIDATION',
              value: validatedMint,
            };
          } catch (e: any) {
            lastRpcError = e;
          }
        }

        const rpcMsg = lastRpcError instanceof Error ? lastRpcError.message : String(lastRpcError || 'Unknown');
        const isRateLimit = rpcMsg.includes('429');
        return {
          ok: false,
          code: isRateLimit ? 'RPC_RATE_LIMITED' : 'RPC_VALIDATION_UNAVAILABLE',
          reason: `RPC_ERROR: ${rpcMsg}`,
          mint: trimmed,
          stage: 'MINT_VALIDATION',
        };
      } finally {
        this.inFlightRequests.delete(trimmed);
      }
    })();

    this.inFlightRequests.set(trimmed, validationPromise);
    return await validationPromise;
  }

  private getRpcConnections(): Connection[] {
    const urls = [...new Set([
      process.env.EXECUTION_RPC_URL,
      process.env.EXECUTION_RPC_BACKUP_URL,
      process.env.SEARCH_RPC_URL,
      process.env.SEARCH_RPC_BACKUP_URL,
      process.env.MONITOR_RPC_URL,
      process.env.MONITOR_RPC_BACKUP_URL,
      process.env.MAINNET_RPC_URL,
      'https://api.mainnet-beta.solana.com',
    ].filter((v): v is string => !!v && v.trim().length > 0).map(v => v.trim()))];
    return urls.map(url => new Connection(url, 'confirmed'));
  }

  private logValidationEvent(
    mint: string,
    result: 'VALID' | 'INVALID',
    reason: string,
    owner: string | null,
    decimals?: number
  ): void {
    console.log(JSON.stringify({
      event: 'MINT_VALIDATION',
      mint,
      result,
      reason,
      owner: owner || 'UNKNOWN',
      decimals: decimals !== undefined ? decimals : null,
      timestamp: Date.now(),
    }));
  }

  public isValidMint(address: string): boolean {
    if (!address || typeof address !== 'string') return false;
    const trimmed = address.trim();
    if (!this.isValidPublicKey(trimmed)) return false;
    if (KNOWN_PROGRAMS_AND_NON_MINTS.has(trimmed)) return false;
    const neg = this.negativeCache.get(trimmed);
    if (neg && Date.now() < neg.expiresAt) return false;
    return true;
  }

  public async isValidMintAsync(address: string, connection?: Connection | null): Promise<boolean> {
    const res = await this.validateTokenMint(address, connection);
    return res.ok;
  }

  public classifyAddress(address: string): ResolvedMintResult {
    if (!address || typeof address !== 'string') {
      return {
        mint: '',
        classification: 'UNKNOWN',
        isValidMint: false,
        reason: 'EMPTY_OR_NON_STRING_ADDRESS',
      };
    }

    const trimmed = address.trim();

    if (!this.isValidPublicKey(trimmed)) {
      return {
        mint: trimmed,
        classification: 'UNKNOWN',
        isValidMint: false,
        reason: 'INVALID_BASE58_OR_BYTE_LENGTH',
      };
    }

    if (KNOWN_PROGRAMS_AND_NON_MINTS.has(trimmed)) {
      return {
        mint: trimmed,
        classification: 'PROGRAM_ID',
        isValidMint: false,
        reason: 'KNOWN_PROGRAM_OR_CORE_PDA',
      };
    }

    const negCached = this.negativeCache.get(trimmed);
    if (negCached && Date.now() < negCached.expiresAt) {
      return {
        mint: trimmed,
        classification: 'UNKNOWN',
        isValidMint: false,
        reason: negCached.reason,
      };
    }

    const posCached = this.positiveCache.get(trimmed);
    if (posCached && Date.now() < posCached.expiresAt) {
      return {
        mint: trimmed,
        classification: 'TOKEN_MINT',
        isValidMint: true,
        reason: 'CACHED_VALID_MINT',
      };
    }

    return {
      mint: trimmed,
      classification: 'TOKEN_MINT',
      isValidMint: true,
      reason: 'SYNTACTICALLY_VALID_CANDIDATE',
    };
  }

  public extractMintFromLogs(logs: string[]): string | null {
    if (!logs || !Array.isArray(logs)) return null;

    for (const log of logs) {
      if (typeof log !== 'string') continue;

      const mintMatch = log.match(/Program log: (?:mint|token_mint|mintAddress):?\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i);
      if (mintMatch && mintMatch[1]) {
        const candidate = mintMatch[1].trim();
        if (this.isValidMint(candidate)) return candidate;
      }

      const jsonMatch = log.match(/\{.*"mint"\s*:\s*"([1-9A-HJ-NP-Za-km-z]{32,44})".*\}/);
      if (jsonMatch && jsonMatch[1]) {
        const candidate = jsonMatch[1].trim();
        if (this.isValidMint(candidate)) return candidate;
      }

      const initMintMatch = log.match(/Instruction: (?:InitializeMint|InitializeMint2|CreateToken|CreatePool).*?([1-9A-HJ-NP-Za-km-z]{32,44})/i);
      if (initMintMatch && initMintMatch[1]) {
        const candidate = initMintMatch[1].trim();
        if (this.isValidMint(candidate)) return candidate;
      }
    }

    return null;
  }

  public extractCandidateMintsFromAccountKeys(accountKeys: string[]): string[] {
    if (!accountKeys || !Array.isArray(accountKeys)) return [];

    const candidates: string[] = [];
    for (const key of accountKeys) {
      if (this.isValidMint(key)) {
        candidates.push(key.trim());
      }
    }

    return candidates;
  }
}

export const tokenMintResolver = TokenMintResolver.getInstance();

export async function validateTokenMint(
  address: string,
  connection?: Connection | null,
  options?: { forceRefresh?: boolean; timeoutMs?: number }
): Promise<MintValidationResult> {
  return TokenMintResolver.getInstance().validateTokenMint(address, connection, options);
}

