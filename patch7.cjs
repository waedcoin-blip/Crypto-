const fs = require('fs');
let code = fs.readFileSync('src/services/WalletBalanceService.ts', 'utf8');

code = code.replace(`  async refreshNow(): Promise<void> {
     // Optional helper
  }`, '');

fs.writeFileSync('src/services/WalletBalanceService.ts', code);
console.log('Replaced successfully');
