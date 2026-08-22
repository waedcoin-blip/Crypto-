const fs = require('fs');
let code = fs.readFileSync('src/services/RealTradeExecutor.ts', 'utf8');

const devnetStart = code.indexOf("if (this.network === 'devnet') {");
const elseStart = code.indexOf("} else {", devnetStart);
if (devnetStart !== -1 && elseStart !== -1) {
  const replacement = `if (this.network === 'devnet') {
        throw new Error("Devnet swap unavailable: Jupiter aggregator is not deployed on Solana Devnet. A Mainnet Jupiter transaction cannot be executed on Devnet. Please switch to Mainnet for live trading, or implement a Devnet-specific AMM (e.g., Raydium Devnet AMM).");
      `;
  code = code.substring(0, devnetStart) + replacement + code.substring(elseStart);
}

// Also update getQuote
const getQuoteStart = code.indexOf("async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {");
if (getQuoteStart !== -1) {
    const insertPos = code.indexOf("{", getQuoteStart) + 1;
    const insertStr = `\n    if (this.network === 'devnet') {
      throw new Error("Jupiter API is not available on Solana Devnet. Cannot fetch quotes for Devnet execution.");
    }`;
    code = code.substring(0, insertPos) + insertStr + code.substring(insertPos);
}

fs.writeFileSync('src/services/RealTradeExecutor.ts', code);
