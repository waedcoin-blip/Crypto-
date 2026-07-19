import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import { useAppStore } from '../store/appStore';
import { getLatestBlockhashWithFallback, executeTxWithRPCFallback } from './jupiterService';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface SwapResult {
  txid: string;
  outputAmount: number;
  quoteOutAmountRaw?: number;
}

/**
 * Centrally manages and executes Jupiter V6 swap transactions on-chain.
 */
export async function executeJupiterSwap({
  inputMint,
  outputMint,
  amount,
  privateKey,
  apiKey,
  jupRpcUrl,
  slippage,
  customSlippageBps,
  minExpectedOutSol
}: {
  inputMint: string;
  outputMint: string;
  amount: number;
  privateKey: string;
  apiKey?: string;
  jupRpcUrl: string;
  slippage: number;
  customSlippageBps?: number;
  minExpectedOutSol?: number;
}): Promise<SwapResult> {
  if (inputMint.toLowerCase().startsWith('sim') || outputMint.toLowerCase().startsWith('sim')) {
    throw new Error("Trading of tokens starting with 'sim' is strictly blocked.");
  }

  if (!privateKey) throw new Error("Private Key missing");
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  const connection = new Connection(jupRpcUrl);

  let baseUrl = 'https://api.jup.ag';
  let apiHeaders: Record<string, string> = {};
  if (apiKey) {
    if (apiKey.startsWith('http')) {
      baseUrl = apiKey;
    } else {
      apiHeaders['x-api-key'] = apiKey;
    }
  }

  if (baseUrl.includes('jup.ag/portfolio') || baseUrl.includes('jup.ag/swap')) {
    throw new Error('Please do not use your Jupiter portfolio URL. Leave the API URL blank to use the default one, or use a valid Jupiter API endpoint.');
  }
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  useAppStore.getState().addJupiterLog({
    type: 'QUOTE',
    message: `Requesting direct quote ${inputMint.slice(0,6)} -> ${outputMint.slice(0,6)}`,
    details: { amount }
  });

  const slippageToUse = customSlippageBps !== undefined ? customSlippageBps : Math.floor(slippage * 100);
  const quoteUrl = `/api/jup/quote?baseUrl=${encodeURIComponent(normalizedBaseUrl)}&inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(amount)}&slippageBps=${slippageToUse}&t=${Date.now()}`;
  
  let quoteResponse;
  const quoteRes = await fetch(quoteUrl, { headers: apiHeaders });
  const quoteText = await quoteRes.text();
  
  try {
    if (!quoteRes.ok) {
      let errorData: any;
      try {
        errorData = JSON.parse(quoteText);
      } catch (e) {}

      if (quoteRes.status === 400 && errorData?.errorCode === 'TOKEN_NOT_TRADABLE') {
        throw new Error('Token is not tradable on Jupiter yet.');
      }
      if (quoteRes.status === 500 && typeof errorData?.error === 'string' && errorData.error.includes('Missing token program')) {
        throw new Error('Token is missing a required program (it might not be fully launched or supported on Jupiter).');
      }
      if (quoteRes.status === 429) {
        throw new Error('Jupiter API Rate Limited (429). Retrying or waiting may be required.');
      }
      if (quoteRes.status === 500 && errorData?.error === "Fetch failed") {
        throw new Error(`Jupiter Proxy Error: ${errorData.message} (${errorData.detail}). Targeting: ${errorData.url}`);
      }
      if (quoteRes.status === 404) {
         throw new Error("Jupiter Quote API returned 404. If you don't have a premium URL, please leave the API URL BLANK in settings.");
      }
      throw new Error(`Status ${quoteRes.status}: ${quoteText.slice(0, 100)}`);
    }
    quoteResponse = JSON.parse(quoteText);
    useAppStore.getState().addJupiterLog({
      type: 'INFO',
      message: `Direct Quote Success: ${quoteResponse.outAmount}`,
      details: { outAmount: quoteResponse.outAmount }
    });
    
    if (minExpectedOutSol !== undefined && outputMint === SOL_MINT) {
       const guaranteedSol = Number(quoteResponse.otherAmountThreshold) / 1_000_000_000;
       if (guaranteedSol < minExpectedOutSol) {
         throw new Error(`PROFIT GUARD: Jupiter guaranteed out (${guaranteedSol.toFixed(4)} SOL) is lower than the required minimum (${minExpectedOutSol.toFixed(4)} SOL). Swap aborted.`);
       }
    }
  } catch (e: any) {
    useAppStore.getState().addJupiterLog({
      type: 'ERROR',
      message: `Direct Quote Error: ${e.message}`,
    });
    throw new Error(e.message.startsWith('Jupiter') ? e.message : `Jupiter Quote API Error: ${e.message}`);
  }

  if (quoteResponse.error) throw new Error(quoteResponse.error);

  const swapRes = await fetch(`/api/jup/swap?baseUrl=${encodeURIComponent(normalizedBaseUrl)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...apiHeaders
    },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: keypair.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 150000,
    })
  });
  const swapText = await swapRes.text();
  let swapTxResp;
  try {
    if (!swapRes.ok) {
      let errorData: any;
      try {
        errorData = JSON.parse(swapText);
      } catch (e) {}

      if (swapRes.status === 500 && errorData?.error === "Fetch failed") {
        throw new Error(`Jupiter Proxy Error: ${errorData.message} (${errorData.detail}). Targeting: ${errorData.url}`);
      }
      throw new Error(`Status ${swapRes.status}: ${swapText.slice(0, 100)}`);
    }
    swapTxResp = JSON.parse(swapText);
    useAppStore.getState().addJupiterLog({
      type: 'INFO',
      message: `Direct Swap Transaction Built Successfully`,
    });
  } catch (e: any) {
    useAppStore.getState().addJupiterLog({
      type: 'ERROR',
      message: `Direct Swap Build Error: ${e.message}`,
    });
    throw new Error(e.message.startsWith('Jupiter') ? e.message : `Jupiter Swap API Error: ${e.message}`);
  }

  if (swapTxResp.error) throw new Error(swapTxResp.error);

  const swapTransactionBuf = Buffer.from(swapTxResp.swapTransaction, 'base64');
  const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

  try {
    const latestBlockhash = await getLatestBlockhashWithFallback(connection);
    transaction.message.recentBlockhash = latestBlockhash.blockhash;
    useAppStore.getState().addJupiterLog({
      type: 'INFO',
      message: `Injected fresh blockhash: ${latestBlockhash.blockhash.slice(0, 8)}...`,
    });
  } catch (bhErr: any) {
    console.warn("Failed to inject fresh blockhash, using Jupiter's original:", bhErr.message || bhErr);
  }

  transaction.sign([keypair]);

  try {
    const txid = await executeTxWithRPCFallback(transaction, connection);
    return { 
      txid, 
      outputAmount: parseFloat(quoteResponse.outAmount), 
      quoteOutAmountRaw: Number(quoteResponse.outAmount)
    };
  } catch (e: any) {
    useAppStore.getState().addJupiterLog({
      type: 'ERROR',
      message: `Transaction Execution failed: ${e.message}`,
    });
    throw e;
  }
}
