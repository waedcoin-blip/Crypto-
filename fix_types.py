import re

with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

# 1. Fix externalSettings type definition
type_def_old = """    simRealTakeProfit?: number;
    setSimRealTakeProfit?: (v: number) => void;
    simRealStopLoss?: number;
    setSimRealStopLoss?: (v: number) => void;"""

type_def_new = """    simRealTakeProfitRaydium?: number;
    setSimRealTakeProfitRaydium?: (v: number) => void;
    simRealTakeProfitBonding?: number;
    setSimRealTakeProfitBonding?: (v: number) => void;
    simRealStopLossRaydium?: number;
    setSimRealStopLossRaydium?: (v: number) => void;
    simRealStopLossBonding?: number;
    setSimRealStopLossBonding?: (v: number) => void;
    simRealStopLossPumpSwap?: number;
    setSimRealStopLossPumpSwap?: (v: number) => void;
    simRealStopLossUnknown?: number;
    setSimRealStopLossUnknown?: (v: number) => void;"""
content = content.replace(type_def_old, type_def_new)

# 2. Fix externalSettings destructuring
destruct_old = """    simRealTakeProfit = 10, setSimRealTakeProfit = () => {},
    simRealStopLoss = -10, setSimRealStopLoss = () => {},"""

destruct_new = """    simRealTakeProfitRaydium = 50, setSimRealTakeProfitRaydium = () => {},
    simRealTakeProfitBonding = 100, setSimRealTakeProfitBonding = () => {},
    simRealStopLossRaydium = -15, setSimRealStopLossRaydium = () => {},
    simRealStopLossBonding = -20, setSimRealStopLossBonding = () => {},
    simRealStopLossPumpSwap = -15, setSimRealStopLossPumpSwap = () => {},
    simRealStopLossUnknown = -20, setSimRealStopLossUnknown = () => {},"""
content = content.replace(destruct_old, destruct_new)

# if destructuring was already partially updated, we might have duplicate lines. Let's clean up if so.
# Check if "simRealTakeProfitRaydium = 50, setSimRealTakeProfitRaydium = () => {}," exists multiple times
if content.count("simRealTakeProfitRaydium = 50, setSimRealTakeProfitRaydium = () => {},") > 1:
    print("Warning: multiple occurrences found in destructuring")

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)

# 3. Fix SimRealPage.tsx type error with TokenStageInfo
with open('src/components/pages/SimRealPage.tsx', 'r') as f:
    content = f.read()

content = content.replace("stageInfo.type ===", "stageInfo.platform ===")
content = content.replace("stageInfo.type", "stageInfo.platform")
content = content.replace("stageInfo.platform === 'PUMP_FUN_RAYDIUM'", "stageInfo.platform === 'RAYDIUM'")
content = content.replace("stageInfo.platform === 'PUMP_FUN_BONDING'", "stageInfo.platform === 'PUMP_FUN' && stageInfo.stage === 'BONDING'")
content = content.replace("stageInfo.platform === 'PUMP_SWAP'", "stageInfo.platform === 'PUMPSWAP'")
content = content.replace("stageInfo.platform === 'UNKNOWN'", "stageInfo.platform === 'UNKNOWN' || stageInfo.stage === 'UNKNOWN'")

with open('src/components/pages/SimRealPage.tsx', 'w') as f:
    f.write(content)

