// server/market/TokenMintResolver.ts
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

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

  // Known Native Base Tokens & Common Non-Meme Assets
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // JitoSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', // bSOL

  // Pump.fun Global Authorities, Fee Recipients & System PDAs
  '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf', // Pump.fun Global Authority
  'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', // Pump.fun Fee Recipient
  'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1', // Pump.fun Mint Authority
]);

export class TokenMintResolver {
  private static instance: TokenMintResolver;
  private verifiedMintCache: Map<string, { isValid: boolean; checkedAt: number }> = new Map();
  private readonly cacheTtlMs = 600000; // 10 minutes cache

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
    if (!address || typeof address !== 'string') return false;
    const trimmed = address.trim();
    if (trimmed.length < 32 || trimmed.length > 44) return false;

    try {
      const decoded = bs58.decode(trimmed);
      return decoded.length === 32;
    } catch {
      return false;
    }
  }

  /**
   * Resolves whether an address is a genuine candidate token mint.
   * Rejects Program IDs, PDAs, Sysvars, Native SOL/USDC, and invalid Base58 strings.
   */
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

    // Check fast cache
    const cached = this.verifiedMintCache.get(trimmed);
    if (cached && Date.now() - cached.checkedAt < this.cacheTtlMs) {
      return {
        mint: trimmed,
        classification: cached.isValid ? 'TOKEN_MINT' : 'UNKNOWN',
        isValidMint: cached.isValid,
        reason: cached.isValid ? 'CACHED_VALID_MINT' : 'CACHED_INVALID_MINT',
      };
    }

    // By default, if valid base58 and not in known non-mints list, it qualifies as candidate mint
    const isValid = true;
    this.verifiedMintCache.set(trimmed, { isValid, checkedAt: Date.now() });

    return {
      mint: trimmed,
      classification: 'TOKEN_MINT',
      isValidMint: true,
      reason: 'VALID_CANDIDATE_MINT',
    };
  }

  /**
   * Fast boolean check for token discovery pipelines.
   */
  public isValidMint(address: string): boolean {
    return this.classifyAddress(address).isValidMint;
  }

  /**
   * Parses log messages from transaction logs (e.g. Pump.fun creation logs) to extract
   * the real newly initialized SPL Token Mint.
   */
  public extractMintFromLogs(logs: string[]): string | null {
    if (!logs || !Array.isArray(logs)) return null;

    for (const log of logs) {
      if (typeof log !== 'string') continue;

      // 1. Pump.fun mint created log pattern: "Program log: mint: <mintAddress>"
      const mintMatch = log.match(/Program log: (?:mint|token_mint|mintAddress):?\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i);
      if (mintMatch && mintMatch[1]) {
        const candidate = mintMatch[1].trim();
        if (this.isValidMint(candidate)) return candidate;
      }

      // 2. Pump.fun Create instruction log: "Program log: Instruction: Create"
      // If the log contains base58 addresses in JSON or structured form
      const jsonMatch = log.match(/\{.*"mint"\s*:\s*"([1-9A-HJ-NP-Za-km-z]{32,44})".*\}/);
      if (jsonMatch && jsonMatch[1]) {
        const candidate = jsonMatch[1].trim();
        if (this.isValidMint(candidate)) return candidate;
      }

      // 3. InitializeMint2 / InitializeMint instruction
      const initMintMatch = log.match(/Instruction: (?:InitializeMint|InitializeMint2|CreateToken|CreatePool).*?([1-9A-HJ-NP-Za-km-z]{32,44})/i);
      if (initMintMatch && initMintMatch[1]) {
        const candidate = initMintMatch[1].trim();
        if (this.isValidMint(candidate)) return candidate;
      }
    }

    return null;
  }

  /**
   * Extracts the candidate token mint from an array of transaction account keys,
   * strictly filtering out known programs, sysvars, and DEX addresses.
   */
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
