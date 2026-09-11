// server/config/rpcRouting.ts

export function getPrimaryRpc(purpose: string = 'default'): string {
  return process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
}

export function getFallbackRpc(): string {
  return 'https://api.mainnet-beta.solana.com';
}
