// server/wallet/TokenProgramResolver.ts
import { Connection, PublicKey } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
} from '@solana/spl-token';

export interface TokenProgramInfo {
  mint: string;
  programId: PublicKey;
  programName: 'spl-token' | 'token-2022';
  decimals: number;
}

export class TokenProgramResolver {
  private static instance: TokenProgramResolver;
  private cache: Map<string, TokenProgramInfo> = new Map();

  private constructor() {}

  public static getInstance(): TokenProgramResolver {
    if (!TokenProgramResolver.instance) {
      TokenProgramResolver.instance = new TokenProgramResolver();
    }
    return TokenProgramResolver.instance;
  }

  public async resolve(
    connection: Connection | null,
    mintAddress: string
  ): Promise<TokenProgramInfo> {
    const mintStr = mintAddress.trim();
    if (this.cache.has(mintStr)) {
      return this.cache.get(mintStr)!;
    }

    if (!connection) throw new Error(`UNRESOLVED_TOKEN_DECIMALS: RPC connection required for ${mintStr}`);

    try {
      const mintPubkey = new PublicKey(mintStr);
      const accInfo = await connection.getAccountInfo(mintPubkey);

      if (accInfo) {
        const ownerStr = accInfo.owner.toBase58();
        const isToken2022 = ownerStr === TOKEN_2022_PROGRAM_ID.toBase58();
        const programId = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        const programName = isToken2022 ? 'token-2022' : 'spl-token';

        const mintData = await getMint(connection, mintPubkey, undefined, programId);
        const decimals = mintData.decimals;

        const info: TokenProgramInfo = {
          mint: mintStr,
          programId,
          programName,
          decimals,
        };
        this.cache.set(mintStr, info);
        return info;
      }
    } catch (e) {
      // Do not guess decimals; quantity corruption is worse than a rejected trade.
    }

    throw new Error(`UNRESOLVED_TOKEN_DECIMALS: Unable to resolve token decimals for mint ${mintStr}`);
  }

  public getAtaAddress(
    ownerPublicKey: PublicKey,
    mintPublicKey: PublicKey,
    programId: PublicKey = TOKEN_PROGRAM_ID
  ): PublicKey {
    return getAssociatedTokenAddressSync(mintPublicKey, ownerPublicKey, false, programId);
  }
}

export const tokenProgramResolver = TokenProgramResolver.getInstance();
