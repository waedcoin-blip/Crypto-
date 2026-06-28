export interface TokenMetric {
  address: string;
  symbol: string;
  buyCount: number;
  sellCount: number;
  buyVolume: number;
  sellVolume: number;
  percentageIncrease: number;
  lastUpdated: number;
  discoveredAt: number;
  recentBuysTimeline: {t: number, a: number, w?: string, type?: 'buy' | 'sell'}[]; // objects with timestamp, amount, and wallet
  latestAlert?: 'VOLUME_SPIKE' | 'WHALE_BUY' | 'HIGH_BUY' | 'MIGRATED' | 'NORMAL' | 'GOLDEN_CROSS';
  whaleEntranceTime?: number;
  isSurging?: boolean;
  
  // Safety & High Profit Metrics
  liquidity?: number;
  volume24h?: number;
  marketCap?: number;
  supply?: number;
  priceUsd?: number;
  priceNative?: number;
  holderCount?: number;
  devWalletPercentage?: number;
  top10Percentage?: number;
  isRugSafe?: boolean;
  liquidityBurned?: boolean;
  volMcRatio?: number;
  holdersPerMin?: number;
  prevBuyCount?: number;
  prevHolderCount?: number;
  buyRatio?: number;
  uniqueWallets?: Set<string>;
  uniqueWalletsCount?: number;
  priceChange1m?: number;
  category?: string; // 'AI' | 'RWA' | 'MEME' | 'DEPIN' | 'GAMEFI' | 'DEFI' | 'POLITIFI' | 'AI_MEME'
  pairCreatedAt?: number;

  // Social Intelligence (Attention Economy)
  socialMentionsGrowth?: number; // % increase
  socialSentiment?: number; // 0-100
  botRisk?: string;
  isAiAgentControlled?: boolean;
  narrativeScore?: number; // 0-100

  // JupShield / RugCheck prioritization
  isSellable?: boolean;
  isVerified?: boolean;
  hasLowLiquidity?: boolean;
  isOrganic?: boolean;
  isNewListing?: boolean;
  highSingleOwnership?: boolean;
  riskScore?: number; // 0-100, lower is better
  warnings?: string[];

  // 100x Scale-Up Criteria
  mintAuthorityRevoked?: boolean;
  freezeAuthorityRevoked?: boolean;
  metadataImmutable?: boolean;
  liquidityRatio?: number;
  holderGrowthHr?: number;
  bondingCurveProgress?: number;
  dexId?: string;
}

export interface TelemetryAlert {
  id: string;
  token: string;
  address: string;
  type: 'VOLUME_SPIKE' | 'WHALE_BUY' | 'HIGH_BUY' | 'MIGRATED' | 'TRENDING' | 'GOLDEN_CROSS' | 'WALLET_TRADE';
  message: string;
  timestamp: number;
}

export interface Trade {
  id: string;
  type: 'buy' | 'sell';
  token: string;
  tokenAddress: string;
  amount: number;
  amountInUsd?: number;
  timestamp: string;
  signature: string;
  status: 'confirmed' | 'pending' | 'failed';
  fromAccount?: string;
}

export interface SniperTrade {
  id: string;
  type: 'BUY' | 'SELL';
  token: string;
  address: string;
  amount: number; // SOL
  price?: number; 
  timestamp: number;
  isScalp?: boolean;
  pnl?: number; // percentage
  signature: string;
}
