const fs = require('fs');
let content = fs.readFileSync('src/services/DevnetAmmExecutor.ts', 'utf8');

// 1. Fix getTokenBalance to sum all accounts instead of just value[0]
const getTokenBalanceRegex = /async getTokenBalance\(mint: string\): Promise<number> \{\s*if \(\!this\.publicKey\) return 0;\s*try \{\s*const accounts = await this\.connection\.getParsedTokenAccountsByOwner\(\s*new PublicKey\(this\.publicKey\),\s*\{ mint: new PublicKey\(mint\) \},\s*'confirmed'\s*\);\s*if \(accounts\.value\.length === 0\) return 0;\s*return Number\(accounts\.value\[0\]\.account\.data\.parsed\.info\.tokenAmount\.amount\);\s*\} catch \{\s*return 0;\s*\}\s*\}/g;

const newGetTokenBalance = `async getTokenBalance(mint: string): Promise<number> {
    if (!this.publicKey) return 0;
    try {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(this.publicKey),
        { mint: new PublicKey(mint) },
        'confirmed'
      );
      if (accounts.value.length === 0) return 0;
      let totalAmount = 0;
      for (const { account } of accounts.value) {
        totalAmount += Number(account.data.parsed.info.tokenAmount.amount);
      }
      return totalAmount;
    } catch {
      return 0;
    }
  }`;

content = content.replace(getTokenBalanceRegex, newGetTokenBalance);

// 2. Add verification of token balance change in swap()
const preTradeBalanceStr = `      const requiredSol = isSolBuy ? amount / LAMPORTS_PER_SOL + 0.002 : 0.002;
      await assertTradeBalance(requiredSol);`;
      
const preTradeBalanceNew = `      const requiredSol = isSolBuy ? amount / LAMPORTS_PER_SOL + 0.002 : 0.002;
      await assertTradeBalance(requiredSol);
      
      const targetTokenMintStr = isSolBuy ? outputMint : inputMint;
      let preTradeTokenBalance = 0;
      if (targetTokenMintStr !== 'So11111111111111111111111111111111111111112') {
         preTradeTokenBalance = await this.getTokenBalance(targetTokenMintStr);
      }`;

content = content.replace(preTradeBalanceStr, preTradeBalanceNew);

const postTradeBalanceStr = `      // 8. Authoritative Post-Trade State Refresh against Devnet RPC
      await this.syncStoreBalances(activePublicKey, targetMintStr);`;

const postTradeBalanceNew = `      // 8. Authoritative Post-Trade State Refresh against Devnet RPC
      await this.syncStoreBalances(activePublicKey, targetMintStr);
      
      if (targetTokenMintStr !== 'So11111111111111111111111111111111111111112') {
         const postTradeTokenBalance = await this.getTokenBalance(targetTokenMintStr);
         if (isSolBuy && postTradeTokenBalance <= preTradeTokenBalance) {
             throw new Error(\`Devnet trade rejected: Transaction confirmed but token balance did not increase. (Pre: \${preTradeTokenBalance}, Post: \${postTradeTokenBalance})\`);
         } else if (!isSolBuy && postTradeTokenBalance >= preTradeTokenBalance && amount > 0) {
             throw new Error(\`Devnet trade rejected: Transaction confirmed but token balance did not decrease. (Pre: \${preTradeTokenBalance}, Post: \${postTradeTokenBalance})\`);
         }
      }`;

content = content.replace(postTradeBalanceStr, postTradeBalanceNew);

fs.writeFileSync('src/services/DevnetAmmExecutor.ts', content);
console.log('DevnetAmmExecutor.ts patched');
