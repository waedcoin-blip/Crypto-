cat << 'INNER_EOF' >> src/services/PaperTradeExecutor.ts

  public executeManualSwap(
    inputMint: string,
    outputMint: string,
    inputAmountSol: number,
    outputAmountRaw: number,
    label: string = 'entry'
  ): string {
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
      inputAmount: inputAmountSol, // Or raw lamports, doesn't matter for logging
      outputAmount: outputAmountRaw,
      feeSol: totalFeeSol,
      success: true,
    });
    return signature;
  }
INNER_EOF
bash patch_paper_manual.sh