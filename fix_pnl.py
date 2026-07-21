import re

with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

content = content.replace("simRealTakeProfit, simRealStopLoss", "simRealTakeProfitRaydium, simRealTakeProfitBonding, simRealStopLossRaydium, simRealStopLossBonding, simRealStopLossPumpSwap, simRealStopLossUnknown")

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)
