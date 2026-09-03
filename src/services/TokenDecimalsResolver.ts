// src/services/TokenDecimalsResolver.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { SOL_MINT } from '../constants/solana';
import { getNetworkConfig } from '../config/network';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { useAppStore } from '../store/appStore';
import { tokenRegistry } from './TokenRegistry';
import { rpcRouting } from './rpcRouting';
import { httpFetch } from './httpClient';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export interface DecimalsCacheEntry {
  mint: string;
  decimals: number;
  program: string;
  source: 'cache' | 'onchain_buffer' | 'registry' | 'store' | 'jup_api' | 'fallback';
  resolvedAt: number;
  verified: boolean;
}

export class TokenDecimalsResolver {
  private static cache = new Map<string, DecimalsCacheEntry>();
  private static inFlight = new Map<string, Promise<number>>();

  public static isSolMint(mint: string): boolean {
    return mint === SOL_MINT || mint === WSOL_MINT;
  }

  public static isPumpMint(mint: string): boolean {
    return typeof mint === 'string' && mint.trim().toLowerCase().endsWith('pump');
  }

  public static resolveSync(tokenMint: string): number {
    const cleanMint = (tokenMint || '').trim();
    if (!cleanMint) throw new Error('INVALID_TOKEN_MINT: Empty mint address');
    if (this.isSolMint(cleanMint)) return 9;

    const cached = this.cache.get(cleanMint);
    if (cached && Number.isInteger(cached.decimals) && cached.decimals >= 0 && cached.decimals <= 255) {
      return cached.decimals;
    }

    const reg = tokenRegistry.getToken(cleanMint);
    if (reg?.decimals !== undefined && Number.isInteger(reg.decimals) && reg.decimals >= 0 && reg.decimals <= 255) {
      return reg.decimals;
    }

    const metric = useAppStore.getState()?.tokenMetrics?.[cleanMint] as any;
    if (metric?.decimals !== undefined && Number.isInteger(metric.decimals) && metric.decimals >= 0 && metric.decimals <= 255) {
      return metric.decimals;
    }

    throw new Error(`UNRESOLVED_TOKEN_DECIMALS: No verified decimals available for mint ${cleanMint}`);
  }

  public static async resolveAsync(tokenMint: string, customConnection?: Connection): Promise<number> {
    const cleanMint = (tokenMint || '').trim();
    if (!cleanMint) throw new Error('INVALID_TOKEN_MINT: Empty mint address');
    if (this.isSolMint(cleanMint)) return 9;

    const cached = this.cache.get(cleanMint);
    if (cached && cached.verified && Number.isInteger(cached.decimals) && cached.decimals >= 0 && cached.decimals <= 255) {
      return cached.decimals;
    }

    if (this.inFlight.has(cleanMint)) {
      return this.inFlight.get(cleanMint)!;
    }

    const promise = (async (): Promise<number> => {
      console.log(`[TOKEN] DECIMALS_RESOLUTION_STARTED mint=${cleanMint}`);

      const reg = tokenRegistry.getToken(cleanMint);
      if (reg?.decimals !== undefined && Number.isInteger(reg.decimals) && reg.decimals >= 0 && reg.decimals <= 255) {
        this.cache.set(cleanMint, {
          mint: cleanMint,
          decimals: reg.decimals,
          program: 'registry',
          source: 'registry',
          resolvedAt: Date.now(),
          verified: true,
        });
        console.log(`[TOKEN] DECIMALS_RESOLVED mint=${cleanMint} decimals=${reg.decimals} program=registry source=registry`);
        return reg.decimals;
      }

      const metric = useAppStore.getState()?.tokenMetrics?.[cleanMint] as any;
      if (metric?.decimals !== undefined && Number.isInteger(metric.decimals) && metric.decimals >= 0 && metric.decimals <= 255) {
        tokenRegistry.registerOrUpdate({ mintAddress: cleanMint, decimals: metric.decimals });
        this.cache.set(cleanMint, {
          mint: cleanMint,
          decimals: metric.decimals,
          program: 'store',
          source: 'store',
          resolvedAt: Date.now(),
          verified: true,
        });
        console.log(`[TOKEN] DECIMALS_RESOLVED mint=${cleanMint} decimals=${metric.decimals} program=store source=store`);
        return metric.decimals;
      }

      let rpcError: any = null;
      const rpcConnections: Connection[] = [];
      if (customConnection) {
        rpcConnections.push(customConnection);
      } else {
        const endpoints = (() => {
          try { return rpcRouting.getRpcEndpoints('search'); } catch { return []; }
        })();
        const fallback = (() => {
          try { return getNetworkConfig(useTradingEnvironmentStore.getState().network || 'paper').rpcUrl; } catch { return ''; }
        })();
        for (const url of [...endpoints, fallback]) {
          if (!url || rpcConnections.some(c => (c as any)._rpcEndpoint === url)) continue;
          try { rpcConnections.push(new Connection(url, 'confirmed')); } catch (e) { rpcError = e; }
        }
      }
      if (rpcConnections.length === 0) throw new Error('SEARCH_RPC_UNAVAILABLE: No RPC endpoints configured for token metadata resolution');

      const mintPubkey = new PublicKey(cleanMint);
      let resolved = false;
      for (let i = 0; i < rpcConnections.length; i++) {
        const connection = rpcConnections[i];
        try {
          console.log(`[TOKEN] DECIMALS_RPC_ATTEMPT mint=${cleanMint} endpoint=${i + 1}/${rpcConnections.length}`);
          const accountInfo = await connection.getAccountInfo(mintPubkey, 'confirmed');
          if (!accountInfo) {
            throw new Error(`INVALID_TOKEN_MINT: Mint account ${cleanMint} does not exist on-chain`);
          }
          const isSpl = accountInfo.owner.equals(TOKEN_PROGRAM_ID);
          const isToken2022 = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
          if (!isSpl && !isToken2022) {
            throw new Error(`TOKEN_PROGRAM_UNSUPPORTED: Account owner ${accountInfo.owner.toBase58()} is not a valid SPL Token or Token-2022 program`);
          }
          const data = accountInfo.data;
          if (!data || data.length < 45) throw new Error(`INVALID_TOKEN_MINT: Mint account data length (${data?.length || 0}) is too short for mint layout`);
          const decimals = data[44];
          if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error(`INVALID_DECIMALS_VALUE: Decimals byte at offset 44 is invalid (${decimals})`);
          const programName = isSpl ? 'SPL' : 'Token-2022';
          tokenRegistry.registerOrUpdate({ mintAddress: cleanMint, decimals });
          this.cache.set(cleanMint, { mint: cleanMint, decimals, program: programName, source: 'onchain_buffer', resolvedAt: Date.now(), verified: true });
          console.log(`[TOKEN] DECIMALS_RESOLVED mint=${cleanMint} decimals=${decimals} program=${programName} source=onchain_buffer`);
          resolved = true;
          return decimals;
        } catch (err: any) {
          rpcError = err;
          const msg = String(err?.message || err);
          console.warn(`[TOKEN] DECIMALS_RPC_FAILED mint=${cleanMint} endpoint=${i + 1}/${rpcConnections.length} reason=${msg}`);
          if (msg.startsWith('INVALID_TOKEN_MINT') || msg.startsWith('TOKEN_PROGRAM_UNSUPPORTED') || msg.startsWith('INVALID_DECIMALS_VALUE')) throw err;
        }
      }
      if (!resolved) console.warn(`[TOKEN] DECIMALS_RPC_EXHAUSTED mint=${cleanMint}`);

      try {
        const res = await httpFetch(`https://tokens.jup.ag/token/${cleanMint}`);
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data.decimals === 'number' && Number.isInteger(data.decimals) && data.decimals >= 0 && data.decimals <= 255) {
            tokenRegistry.registerOrUpdate({
              mintAddress: cleanMint,
              decimals: data.decimals,
              symbol: data.symbol || 'UNKNOWN',
            });
            this.cache.set(cleanMint, {
              mint: cleanMint,
              decimals: data.decimals,
              program: 'JupiterAPI',
              source: 'jup_api',
              resolvedAt: Date.now(),
              verified: true,
            });
            console.log(`[TOKEN] DECIMALS_RESOLVED mint=${cleanMint} decimals=${data.decimals} program=JupiterAPI source=jup_api`);
            return data.decimals;
          }
        }
      } catch (jupErr) {
        // ignore
      }

      throw new Error(`TOKEN_DECIMALS_RESOLUTION_FAILED: Unable to resolve token decimals for mint ${cleanMint}. RPC Error: ${rpcError?.message || 'Unknown'}`);
    })();

    this.inFlight.set(cleanMint, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(cleanMint);
    }
  }

  public static clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}
