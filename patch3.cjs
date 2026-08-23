const fs = require('fs');
let code = fs.readFileSync('src/services/WalletBalanceService.ts', 'utf8');

const target = `  async getTokenBalance(mint: string, walletAddress?: string): Promise<number> {`;

const replacement = `  async getSolBalance(walletAddress?: string): Promise<number> {
    const activeAddress = walletAddress || localStorage.getItem('wallet_address');
    if (!activeAddress) return 0;
    try {
      const balance = await this.connection.getBalance(new PublicKey(activeAddress));
      return balance / 1_000_000_000.0;
    } catch (e) {
      console.warn('Failed to get SOL balance', e);
      return 0;
    }
  }

  async refreshNow(): Promise<void> {
     // Optional helper
  }

  async getTokenBalance(mint: string, walletAddress?: string): Promise<number> {`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/services/WalletBalanceService.ts', code);
  console.log('Replaced successfully');
} else {
  console.log('Target not found');
}
