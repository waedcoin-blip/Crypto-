// src/services/NetworkGuard.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig, TradingNetwork } from '../config/network';

export const GENESIS_HASHES: Record<TradingNetwork, string> = {
  mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
};

const genesisHashCache: Map<string, string> = new Map();

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
          'NETWORK SAFETY ERROR: Devnet cannot use Mainnet RPC endpoint'
        );
      }
    }

    if (network === 'mainnet') {
      if (rpcUrl.includes('devnet')) {
        throw new Error(
          'NETWORK SAFETY ERROR: Mainnet cannot use Devnet RPC endpoint'
        );
      }
    }

    if (!config.rpcUrl && !rpcUrl) {
      throw new Error(
        `No RPC configured for ${network}`
      );
    }
  }

  /**
   * On-chain cryptographic genesis hash verification.
   * Confirms the target RPC node belongs to the declared cluster.
   */
  static async verifyGenesisHash(
    network: TradingNetwork,
    rpcUrl: string
  ): Promise<boolean> {
    this.assertNetwork(network, rpcUrl);

    const expectedGenesis = GENESIS_HASHES[network];
    if (!expectedGenesis) return true;

    try {
      let genesis = genesisHashCache.get(rpcUrl);
      if (!genesis) {
        const connection = new Connection(rpcUrl, 'confirmed');
        genesis = await connection.getGenesisHash();
        genesisHashCache.set(rpcUrl, genesis);
      }

      if (genesis !== expectedGenesis) {
        throw new Error(
          `GENESIS HASH MISMATCH: RPC node reported genesis hash '${genesis}', expected '${expectedGenesis}' for ${network}.`
        );
      }
      return true;
    } catch (err: any) {
      if (err.message?.includes('GENESIS HASH MISMATCH')) {
        throw err;
      }
      // If RPC provider blocks getGenesisHash, fallback to URL assertions
      console.warn(`[NetworkGuard] getGenesisHash probe failed on ${rpcUrl}: ${err.message}`);
      return true;
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
