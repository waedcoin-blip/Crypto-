// src/services/HeliusSender.ts
import { Connection, VersionedTransaction } from '@solana/web3.js';

export interface SenderConfig {
  heliusRpcUrl: string;
  tier: 'swqos' | 'max';
  tipSol: number;
  skipPreflight?: boolean;
}

export class HeliusSender {
  private connection: Connection;
  private config: SenderConfig;

  constructor(config: SenderConfig) {
    this.config = config;
    this.connection = new Connection(config.heliusRpcUrl, 'confirmed');
  }

  async sendTransaction(tx: VersionedTransaction): Promise<string> {
    const serialized = Buffer.from(tx.serialize()).toString('base64');
    const response = await fetch(this.config.heliusRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [
          serialized,
          {
            encoding: 'base64',
            skipPreflight: this.config.skipPreflight ?? true,
            maxRetries: 2,
            minContextSlot: await this.connection.getSlot(),
          },
        ],
      }),
    });
    const json = await response.json();
    if (json.error) throw new Error(`Helius Sender error: ${JSON.stringify(json.error)}`);
    return json.result as string;
  }

  async confirm(signature: string, timeoutMs = 15000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.connection.getSignatureStatus(signature);
      if (
        status?.value?.confirmationStatus === 'confirmed' ||
        status?.value?.confirmationStatus === 'finalized'
      ) {
        return !status.value.err;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Confirmation timeout');
  }
}
