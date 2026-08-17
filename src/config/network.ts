// src/config/network.ts

/// <reference types="vite/client" />

export type TradingNetwork = 'devnet' | 'mainnet';

export interface NetworkConfig {
  network: TradingNetwork;
  rpcUrl: string;
  wsUrl: string;
  explorerCluster: 'devnet' | 'mainnet-beta';
  isProduction: boolean;
}

const DEVNET_RPC =
  import.meta.env.VITE_DEVNET_RPC_URL ||
  'https://api.devnet.solana.com';

const MAINNET_RPC =
  import.meta.env.VITE_MAINNET_RPC_URL ||
  'https://api.mainnet.solana.com';

function toWsUrl(rpcUrl: string): string {
  if (rpcUrl.startsWith('https://')) {
    return rpcUrl.replace('https://', 'wss://');
  }

  if (rpcUrl.startsWith('http://')) {
    return rpcUrl.replace('http://', 'ws://');
  }

  return rpcUrl;
}

export function getNetworkConfig(
  network: TradingNetwork
): NetworkConfig {
  if (network === 'devnet') {
    return {
      network: 'devnet',
      rpcUrl: DEVNET_RPC,
      wsUrl: toWsUrl(DEVNET_RPC),
      explorerCluster: 'devnet',
      isProduction: false,
    };
  }

  return {
    network: 'mainnet',
    rpcUrl: MAINNET_RPC,
    wsUrl: toWsUrl(MAINNET_RPC),
    explorerCluster: 'mainnet-beta',
    isProduction: true,
  };
}
