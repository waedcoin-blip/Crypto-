import re

with open('src/services/PositionExitManager.ts', 'r') as f:
    content = f.read()

content = content.replace(
    "export type ExitCallback = (\n  mint: string,\n  side: 'tp' | 'sl',\n  signature: string,\n  pnlPct: number\n) => void;",
    "export type ExitCallback = (\n  mint: string,\n  side: 'tp' | 'sl',\n  signature: string,\n  pnlPct: number,\n  outputAmountSol?: number\n) => void;"
)

content = content.replace(
    "this.onExitCallback(mint, side, result.signature || 'exit-tx', pnlPct);",
    "this.onExitCallback(mint, side, result.signature || 'exit-tx', pnlPct, result.outputAmount / 1e9);"
)

with open('src/services/PositionExitManager.ts', 'w') as f:
    f.write(content)
