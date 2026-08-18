sed -i 's/const outputAmount = Number(quote.otherAmountThreshold);/const outputAmount = Number(quote.outAmount);/' src/services/PaperTradeExecutor.ts
sed -i 's/this.addTokenBalance(outputMint, outputAmount, 6);/this.addTokenBalance(outputMint, outputAmount, 0);/g' src/services/PaperTradeExecutor.ts
