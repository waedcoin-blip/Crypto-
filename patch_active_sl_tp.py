import re
import sys

def patch_simreal_page():
    with open('src/components/pages/SimRealPage.tsx', 'r') as f:
        content = f.read()

    # Find the block where activeSL is calculated
    logic_old = """
                      let activeSL = stopLoss;
                      if (stage.platform === 'PUMP_FUN' || stage.isBonding) {
                        activeSL = bondingCurveStopLoss;
                      } else if (stage.platform === 'PUMPSWAP') {
                        activeSL = pumpSwapStopLoss;
                      } else if (stage.platform === 'UNKNOWN' || stage.stage === 'UNKNOWN') {
                        activeSL = unknownStopLoss;
                      } else {
                        activeSL = stopLoss;
                      }
"""
    logic_new = """
                      let activeTP = simRealTakeProfitRaydium;
                      let activeSL = simRealStopLossRaydium;
                      
                      if (stage.platform === 'RAYDIUM' || stage.isMigrated) {
                        activeTP = simRealTakeProfitRaydium;
                        activeSL = simRealStopLossRaydium;
                      } else if (stage.platform === 'PUMP_FUN' && stage.stage === 'BONDING') {
                        activeTP = simRealTakeProfitBonding;
                        activeSL = simRealStopLossBonding;
                      } else if (stage.platform === 'PUMPSWAP') {
                        activeTP = simRealTakeProfitRaydium; // reuse since no specific pumpswap TP UI
                        activeSL = simRealStopLossPumpSwap;
                      } else {
                        activeTP = simRealTakeProfitRaydium;
                        activeSL = simRealStopLossUnknown;
                      }
"""
    content = content.replace(logic_old.strip(), logic_new.strip())
    
    # Also we need to make sure the JSX renders activeTP and activeSL correctly
    # Let's check where activeSL is rendered
    # "<span className="text-rose-400 text-[9px] whitespace-nowrap bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">SL: {activeSL}%</span>"
    
    with open('src/components/pages/SimRealPage.tsx', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    patch_simreal_page()
    print("Done")
