import { getJupiterQuote } from '../../services/jupiterService';
import { createJupiterApiClient } from '@jup-ag/api';

export class JupiterExecutionService {
  public static async getExecutableQuote(inputMint: string, outputMint: string, amount: number, slippageBps = 250) {
    return getJupiterQuote(inputMint, outputMint, amount, 0, undefined, undefined, undefined, false, false, slippageBps);
  }

  public static async buildSwapTransaction(quoteResponse: any, userPublicKey: string) {
    const api = createJupiterApiClient();
    return api.swapPost({
      swapRequest: {
        quoteResponse,
        userPublicKey,
        dynamicComputeUnitLimit: true,
      },
    });
  }
}

