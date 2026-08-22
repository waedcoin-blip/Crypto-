// src/services/devnetTokenApi.ts
export interface DevnetToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  bondingCurve: string;
  associatedBondingCurve: string;
  complete: boolean;
  pool: string | null;
  virtualTokenReserves: string;
  virtualSolReserves: string;
  realTokenReserves: string;
  realSolReserves: string;
  tokenTotalSupply: string;
  priceUsd: number;
  priceSol: number;
  liquidityUsd: number;
  volume24h: number;
  marketCap: number;
  creator: string;
  description: string;
  imageUrl: string;
  createdAt: number;
  isDevnetTestToken: boolean;
}

export interface CreateDevnetTokenParams {
  name: string;
  symbol: string;
  decimals?: number;
  initialSupply?: number;
  targetWallet?: string;
  complete?: boolean;
  virtualSolReserves?: number;
  realSolReserves?: number;
  description?: string;
}

export interface DevnetTokensResponse {
  success: boolean;
  network: string;
  rpcUrl: string;
  count: number;
  tokens: DevnetToken[];
}

export interface CreateTokenResponse {
  success: boolean;
  message: string;
  token: DevnetToken;
  explorerUrl: string;
  bondingCurveExplorerUrl: string;
}

export interface AirdropResponse {
  success: boolean;
  signature: string;
  amountAirdroppedSol: number;
  newBalanceSol: number;
  explorerUrl: string;
}

export interface VerifyTokenResponse {
  success: boolean;
  mint: string;
  onChainExists: boolean;
  hasBondingCurve: boolean;
  owner: string | null;
  lamports: number;
  dataLength: number;
  explorerUrl: string;
}

class DevnetTokenApi {
  /**
   * Fetch all Devnet tokens from server registry.
   */
  async getDevnetTokens(complete?: boolean, search?: string): Promise<DevnetToken[]> {
    try {
      const params = new URLSearchParams();
      if (complete !== undefined) params.append('complete', complete.toString());
      if (search) params.append('q', search);

      const res = await fetch(`/api/devnet/tokens?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DevnetTokensResponse = await res.json();
      return data.tokens || [];
    } catch (err) {
      console.warn('[DevnetTokenApi] Failed to fetch devnet tokens:', err);
      return [];
    }
  }

  /**
   * Fetch a single Devnet token by mint.
   */
  async getDevnetToken(mint: string): Promise<DevnetToken | null> {
    try {
      const res = await fetch(`/api/devnet/tokens/${mint}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.token || null;
    } catch (err) {
      console.warn(`[DevnetTokenApi] Failed to fetch devnet token ${mint}:`, err);
      return null;
    }
  }

  /**
   * Generate and register a new test token on Devnet.
   */
  async createDevnetToken(params: CreateDevnetTokenParams): Promise<CreateTokenResponse> {
    const res = await fetch('/api/devnet/create-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create Devnet test token');
    }
    return data;
  }

  /**
   * Request Devnet SOL airdrop.
   */
  async requestAirdrop(walletAddress: string, amountSol: number = 1): Promise<AirdropResponse> {
    const res = await fetch('/api/devnet/airdrop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, amountSol }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Airdrop request failed');
    }
    return data;
  }

  /**
   * Verify token on Devnet RPC.
   */
  async verifyToken(mint: string): Promise<VerifyTokenResponse> {
    const res = await fetch('/api/devnet/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mint }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Token verification failed');
    }
    return data;
  }
}

export const devnetTokenApi = new DevnetTokenApi();
