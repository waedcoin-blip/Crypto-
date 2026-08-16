// src/services/NetworkGuard.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig, TradingNetwork } from '../config/network';

export class NetworkGuard {
  static assertNetwork(
    network: TradingNetwork,
    rpcUrl: string
  ): void {
    const config = getNetworkConfig(network);

    if (network === 'devnet') {
      if (
        rpcUrl.includes('mainnet') ||
        rpcUrl.includes('mainnet-beta')
      ) {
        throw new Error(
          'NETWORK SAFETY ERROR: Devnet cannot use Mainnet RPC'
        );
      }
    }

    if (network === 'mainnet') {
      if (rpcUrl.includes('devnet')) {
        throw new Error(
          'NETWORK SAFETY ERROR: Mainnet cannot use Devnet RPC'
        );
      }
    }

    if (!config.rpcUrl) {
      throw new Error(
        `No RPC configured for ${network}`
      );
    }
  }

  static async verifyWallet(
    network: TradingNetwork,
    rpcUrl: string,
    wallet: string
  ): Promise<void> {
    this.assertNetwork(network, rpcUrl);

    const connection = new Connection(
      rpcUrl,
      'confirmed'
    );

    const publicKey = new PublicKey(wallet);

    await connection.getBalance(
      publicKey,
      'confirmed'
    );
  }
}
