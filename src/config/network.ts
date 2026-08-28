// src/config/network.ts

/// <reference types="vite/client" />

export type TradingNetwork = 'paper' | 'mainnet';

export interface NetworkConfig {
  network: TradingNetwork;
  rpcUrl: string;
  wsUrl: string;
  explorerCluster: 'mainnet-beta';
  isProduction: boolean;
}

const MAINNET_RPC =
  import.meta.env.VITE_MAINNET_RPC_URL ||
  'https://api.mainnet-beta.solana.com';

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
  if (network === 'paper') {
    return {
      network: 'paper',
      rpcUrl: MAINNET_RPC,
      wsUrl: toWsUrl(MAINNET_RPC),
      explorerCluster: 'mainnet-beta',
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
