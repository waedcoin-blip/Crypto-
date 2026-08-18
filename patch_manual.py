import re

with open('src/services/PaperTradeExecutor.ts', 'r') as f:
    content = f.read()

manual_swap_code = """
  public executeManualSwap(
    inputMint: string,
    outputMint: string,
    inputAmountSol: number,
    outputAmountRaw: number,
    label: string = 'entry'
  ): string {
    const BASE_TX_FEE_SOL = 0.000005; // Make sure this exists
    const totalFeeSol = BASE_TX_FEE_SOL;
    
    if (inputMint === 'So11111111111111111111111111111111111111112') {
      if (this.virtualSol < inputAmountSol + totalFeeSol) {
        throw new Error('Paper trade: insufficient SOL balance');
      }
      this.virtualSol -= (inputAmountSol + totalFeeSol);
      this.addTokenBalance(outputMint, outputAmountRaw, 0);
    } else if (outputMint === 'So11111111111111111111111111111111111111112') {
      // Input is tokens, output is SOL
      this.subTokenBalance(inputMint, inputAmountSol); // Note: inputAmountSol is actually tokenAmount raw here
      this.virtualSol += (outputAmountRaw / 1e9) - totalFeeSol;
    }
    
    const signature = `PAPER-MANUAL-${++this.txCounter}-${Date.now()}`;
    this.txHistory.push({
      signature,
      timestamp: Date.now(),
      inputMint,
      outputMint,
      inputAmount: inputAmountSol,
      outputAmount: outputAmountRaw,
      feeSol: totalFeeSol,
      success: true,
    });
    return signature;
  }

  private getVirtualTokenBalance(mint: string): number {"""

content = content.replace("  private getVirtualTokenBalance(mint: string): number {", manual_swap_code)

with open('src/services/PaperTradeExecutor.ts', 'w') as f:
    f.write(content)
