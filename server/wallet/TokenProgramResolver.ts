// server/wallet/TokenProgramResolver.ts
import { Connection, PublicKey } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';

export interface TokenProgramInfo {
  mint: string;
  programId: PublicKey;
  programName: 'spl-token' | 'token-2022';
  decimals: number;
}

function rpcEndpoints(): string[] {
  return [...new Set([
    process.env.EXECUTION_RPC_URL,
    process.env.EXECUTION_RPC_BACKUP_URL,
    process.env.SEARCH_RPC_URL,
    process.env.SEARCH_RPC_BACKUP_URL,
    process.env.MONITOR_RPC_URL,
    process.env.MONITOR_RPC_BACKUP_URL,
    process.env.MAINNET_RPC_URL,
    'https://api.mainnet-beta.solana.com',
  ].filter((v): v is string => !!v && v.trim().length > 0).map(v => v.trim()))];
}

export class TokenProgramResolver {
  private static instance: TokenProgramResolver;
  private cache: Map<string, TokenProgramInfo> = new Map();

  private constructor() {}

  public static getInstance(): TokenProgramResolver {
    if (!TokenProgramResolver.instance) TokenProgramResolver.instance = new TokenProgramResolver();
    return TokenProgramResolver.instance;
  }

  public async resolve(connection: Connection | null, mintAddress: string): Promise<TokenProgramInfo> {
    const mintStr = mintAddress.trim();
    if (!mintStr) throw new Error('INVALID_TOKEN_MINT: Empty mint address');
    const cached = this.cache.get(mintStr);
    if (cached) return cached;

    let mintPubkey: PublicKey;
    try { mintPubkey = new PublicKey(mintStr); }
    catch { throw new Error(`INVALID_TOKEN_MINT: Invalid public key ${mintStr}`); }

    const connections: Connection[] = connection ? [connection] : rpcEndpoints().map(url => new Connection(url, 'confirmed'));
    if (!connections.length) throw new Error('EXECUTION_RPC_UNAVAILABLE: No RPC endpoint configured for token metadata resolution');

    let lastError: unknown = null;
    for (let i = 0; i < connections.length; i++) {
      const conn = connections[i];
      try {
        const accInfo = await conn.getAccountInfo(mintPubkey, 'confirmed');
        if (!accInfo) throw new Error(`INVALID_TOKEN_MINT: Mint account ${mintStr} does not exist on-chain`);
        const ownerStr = accInfo.owner.toBase58();
        const isToken2022 = ownerStr === TOKEN_2022_PROGRAM_ID.toBase58();
        const isSpl = ownerStr === TOKEN_PROGRAM_ID.toBase58();
        if (!isSpl && !isToken2022) throw new Error(`TOKEN_PROGRAM_UNSUPPORTED: Account owner ${ownerStr} is not a valid SPL Token or Token-2022 program`);
        const programId = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        const mintData = await getMint(conn, mintPubkey, undefined, programId);
        const decimals = mintData.decimals;
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error(`INVALID_DECIMALS_VALUE: ${decimals}`);
        const info: TokenProgramInfo = { mint: mintStr, programId, programName: isToken2022 ? 'token-2022' : 'spl-token', decimals };
        this.cache.set(mintStr, info);
        return info;
      } catch (e: any) {
        lastError = e;
        console.warn(`[TOKEN] DECIMALS_RPC_FAILED mint=${mintStr} endpoint=${i + 1}/${connections.length} reason=${e?.message || e}`);
        const msg = String(e?.message || e);
        if (msg.startsWith('INVALID_TOKEN_MINT') || msg.startsWith('TOKEN_PROGRAM_UNSUPPORTED') || msg.startsWith('INVALID_DECIMALS_VALUE')) throw e;
      }
    }
    throw new Error(`TOKEN_DECIMALS_RESOLUTION_FAILED: Unable to resolve token decimals for mint ${mintStr}. RPC Error: ${lastError instanceof Error ? lastError.message : String(lastError || 'Unknown')}`);
  }

  public getAtaAddress(ownerPublicKey: PublicKey, mintPublicKey: PublicKey, programId: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
    return getAssociatedTokenAddressSync(mintPublicKey, ownerPublicKey, false, programId);
  }
}

export const tokenProgramResolver = TokenProgramResolver.getInstance();
