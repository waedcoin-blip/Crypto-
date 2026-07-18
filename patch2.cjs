const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf-8');

code = code.replace(
  `const executeJupiterSwap = async (inputMint: string, outputMint: string, amount: number) => {`,
  `const executeJupiterSwap = async (inputMint: string, outputMint: string, amount: number, customSlippageBps?: number) => {`
);

code = code.replace(
  `const quoteUrl = \`/api/jup/quote?baseUrl=\${encodeURIComponent(normalizedBaseUrl)}&inputMint=\${inMint}&outputMint=\${outMint}&amount=\${Math.floor(swapAmt)}&slippageBps=\${Math.floor(slippage * 100)}&t=\${Date.now()}\`;`,
  `const slippageToUse = customSlippageBps !== undefined ? customSlippageBps : Math.floor(slippage * 100);
      const quoteUrl = \`/api/jup/quote?baseUrl=\${encodeURIComponent(normalizedBaseUrl)}&inputMint=\${inMint}&outputMint=\${outMint}&amount=\${Math.floor(swapAmt)}&slippageBps=\${slippageToUse}&t=\${Date.now()}\`;`
);

fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log("Patched executeJupiterSwap");
