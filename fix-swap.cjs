const fs = require('fs');
let code = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

const startPattern = "  const executeJupiterSwap = async (inputMint: string, outputMint: string, amount: number, customSlippageBps?: number, minExpectedOutSol?: number) => {";

const startIndex = code.indexOf(startPattern);
if (startIndex === -1) throw new Error("Could not find start");

let braceCount = 0;
let endIndex = -1;
let i = startIndex + startPattern.indexOf('{');
for (; i < code.length; i++) {
  if (code[i] === '{') braceCount++;
  else if (code[i] === '}') {
    braceCount--;
    if (braceCount === 0) {
      endIndex = i;
      break;
    }
  }
}

if (endIndex === -1) throw new Error("Could not find end");

const replacement = `  const executeJupiterSwap = async (inputMint: string, outputMint: string, amount: number, customSlippageBps?: number, minExpectedOutSol?: number) => {
    if (inputMint.toLowerCase().startsWith('sim') || outputMint.toLowerCase().startsWith('sim')) {
      throw new Error("Trading of tokens starting with 'sim' is strictly blocked.");
    }

    if (!user) {
      throw new Error("Authentication required: Please sign in with Google/Firebase before placing real on-chain orders.");
    }

    if (!privateKey) throw new Error("Private Key missing");
    
    const slippageToUse = customSlippageBps !== undefined ? customSlippageBps : Math.floor(slippage * 100);
    const intent = inputMint === SOL_MINT ? 'entry' : 'exit';
    
    const res = await tradeManager.swap(inputMint, outputMint, amount, slippageToUse, intent);
    return {
      txid: res.signature,
      outputAmount: res.outputAmount || 0,
    };
  }`;

code = code.substring(0, startIndex) + replacement + code.substring(endIndex + 1);
fs.writeFileSync('src/components/pages/PnLPage.tsx', code);
console.log('Successfully replaced executeJupiterSwap');
