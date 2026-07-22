/**
 * Solana constants & environment configuration helpers
 */

export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const DEFAULT_SLIPPAGE_BPS = 100;
export const BPS_DIVISOR = 10_000;
export const SIMULATION_SAMPLING_RATE = 0.05;

export const HELIUS_API_KEY =
  (import.meta as any).env?.VITE_HELIUS_API_KEY ||
  (import.meta as any).env?.HELIUS_API_KEY ||
  '';

export const DEFAULT_HELIUS_RPC = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : 'https://api.mainnet-beta.solana.com';

export const DEFAULT_HELIUS_WS = HELIUS_API_KEY
  ? `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : 'wss://api.mainnet-beta.solana.com';
