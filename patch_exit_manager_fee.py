import re

with open('src/services/PositionExitManager.ts', 'r') as f:
    content = f.read()

content = content.replace(
    "this.onExitCallback(mint, side, result.signature || 'exit-tx', pnlPct, result.outputAmount / 1e9);",
    "this.onExitCallback(mint, side, result.signature || 'exit-tx', pnlPct, (result.outputAmount / 1e9) - result.feeSol);"
)

with open('src/services/PositionExitManager.ts', 'w') as f:
    f.write(content)
