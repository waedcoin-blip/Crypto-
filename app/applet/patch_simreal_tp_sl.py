import re
import sys

def patch_app_tsx():
    with open('src/App.tsx', 'r') as f:
        content = f.read()
    
    # 1. State variables
    state_vars = """
  const [simRealTakeProfitRaydium, setSimRealTakeProfitRaydium] = useState(() => Number(localStorage.getItem('app_simRealTakeProfitRaydium')) || 50);
  const [simRealTakeProfitBonding, setSimRealTakeProfitBonding] = useState(() => Number(localStorage.getItem('app_simRealTakeProfitBonding')) || 100);
  const [simRealStopLossRaydium, setSimRealStopLossRaydium] = useState(() => Number(localStorage.getItem('app_simRealStopLossRaydium')) || -15);
  const [simRealStopLossBonding, setSimRealStopLossBonding] = useState(() => Number(localStorage.getItem('app_simRealStopLossBonding')) || -20);
  const [simRealStopLossPumpSwap, setSimRealStopLossPumpSwap] = useState(() => Number(localStorage.getItem('app_simRealStopLossPumpSwap')) || -15);
  const [simRealStopLossUnknown, setSimRealStopLossUnknown] = useState(() => Number(localStorage.getItem('app_simRealStopLossUnknown')) || -20);
"""
    
    content = re.sub(
        r"const \[simRealTakeProfit, setSimRealTakeProfit\].*?\n  const \[simRealStopLoss, setSimRealStopLoss\].*?\n",
        state_vars.strip() + "\n",
        content,
        flags=re.DOTALL
    )

    # 2. LocalStorage sync
    ls_sync = """
    localStorage.setItem('app_simRealTakeProfitRaydium', simRealTakeProfitRaydium.toString());
    localStorage.setItem('app_simRealTakeProfitBonding', simRealTakeProfitBonding.toString());
    localStorage.setItem('app_simRealStopLossRaydium', simRealStopLossRaydium.toString());
    localStorage.setItem('app_simRealStopLossBonding', simRealStopLossBonding.toString());
    localStorage.setItem('app_simRealStopLossPumpSwap', simRealStopLossPumpSwap.toString());
    localStorage.setItem('app_simRealStopLossUnknown', simRealStopLossUnknown.toString());
"""
    content = re.sub(
        r"localStorage\.setItem\('app_simRealTakeProfit', simRealTakeProfit\.toString\(\)\);\n    localStorage\.setItem\('app_simRealStopLoss', simRealStopLoss\.toString\(\)\);",
        ls_sync.strip(),
        content,
        flags=re.DOTALL
    )

    content = re.sub(
        r"simRealTakeProfit, simRealStopLoss",
        "simRealTakeProfitRaydium, simRealTakeProfitBonding, simRealStopLossRaydium, simRealStopLossBonding, simRealStopLossPumpSwap, simRealStopLossUnknown",
        content
    )

    # 3. externalSettings (line ~5909)
    ext_settings_old = """
          simRealTakeProfit, setSimRealTakeProfit,
          simRealStopLoss, setSimRealStopLoss,
"""
    ext_settings_new = """
          simRealTakeProfitRaydium, setSimRealTakeProfitRaydium,
          simRealTakeProfitBonding, setSimRealTakeProfitBonding,
          simRealStopLossRaydium, setSimRealStopLossRaydium,
          simRealStopLossBonding, setSimRealStopLossBonding,
          simRealStopLossPumpSwap, setSimRealStopLossPumpSwap,
          simRealStopLossUnknown, setSimRealStopLossUnknown,
"""
    content = content.replace(ext_settings_old.strip(), ext_settings_new.strip())

    # 4. SimRealPage props (line ~6013)
    simreal_props_old = """
        simRealTakeProfit={simRealTakeProfit}
        setSimRealTakeProfit={setSimRealTakeProfit}
        simRealStopLoss={simRealStopLoss}
        setSimRealStopLoss={setSimRealStopLoss}
"""
    simreal_props_new = """
        simRealTakeProfitRaydium={simRealTakeProfitRaydium}
        setSimRealTakeProfitRaydium={setSimRealTakeProfitRaydium}
        simRealTakeProfitBonding={simRealTakeProfitBonding}
        setSimRealTakeProfitBonding={setSimRealTakeProfitBonding}
        simRealStopLossRaydium={simRealStopLossRaydium}
        setSimRealStopLossRaydium={setSimRealStopLossRaydium}
        simRealStopLossBonding={simRealStopLossBonding}
        setSimRealStopLossBonding={setSimRealStopLossBonding}
        simRealStopLossPumpSwap={simRealStopLossPumpSwap}
        setSimRealStopLossPumpSwap={setSimRealStopLossPumpSwap}
        simRealStopLossUnknown={simRealStopLossUnknown}
        setSimRealStopLossUnknown={setSimRealStopLossUnknown}
"""
    content = content.replace(simreal_props_old.strip(), simreal_props_new.strip())

    with open('src/App.tsx', 'w') as f:
        f.write(content)


def patch_pnl_page():
    with open('src/components/pages/PnLPage.tsx', 'r') as f:
        content = f.read()
    
    # 1. externalSettings Props type
    content = re.sub(
        r"simRealTakeProfit\?: number;\n\s*simRealStopLoss\?: number;",
        """
    simRealTakeProfitRaydium?: number;
    simRealTakeProfitBonding?: number;
    simRealStopLossRaydium?: number;
    simRealStopLossBonding?: number;
    simRealStopLossPumpSwap?: number;
    simRealStopLossUnknown?: number;
        """.strip(),
        content
    )

    # 2. Destructuring
    content = re.sub(
        r"simRealTakeProfit = 10, setSimRealTakeProfit = \(\) => \{\},\n\s*simRealStopLoss = -10, setSimRealStopLoss = \(\) => \{\},",
        """
    simRealTakeProfitRaydium = 50, setSimRealTakeProfitRaydium = () => {},
    simRealTakeProfitBonding = 100, setSimRealTakeProfitBonding = () => {},
    simRealStopLossRaydium = -15, setSimRealStopLossRaydium = () => {},
    simRealStopLossBonding = -20, setSimRealStopLossBonding = () => {},
    simRealStopLossPumpSwap = -15, setSimRealStopLossPumpSwap = () => {},
    simRealStopLossUnknown = -20, setSimRealStopLossUnknown = () => {},
        """.strip(),
        content
    )

    with open('src/components/pages/PnLPage.tsx', 'w') as f:
        f.write(content)

def patch_simreal_page():
    with open('src/components/pages/SimRealPage.tsx', 'r') as f:
        content = f.read()

    # Import detectTokenStage
    if "detectTokenStage" not in content:
        content = content.replace("import { SniperTrade } from '../../types';", "import { SniperTrade } from '../../types';\nimport { detectTokenStage } from '../../lib/utils';")

    # 1. SimRealPageProps type
    props_type_old = """
  simRealTakeProfit: number;
  setSimRealTakeProfit: (v: number) => void;
  simRealStopLoss: number;
  setSimRealStopLoss: (v: number) => void;
"""
    props_type_new = """
  simRealTakeProfitRaydium: number;
  setSimRealTakeProfitRaydium: (v: number) => void;
  simRealTakeProfitBonding: number;
  setSimRealTakeProfitBonding: (v: number) => void;
  simRealStopLossRaydium: number;
  setSimRealStopLossRaydium: (v: number) => void;
  simRealStopLossBonding: number;
  setSimRealStopLossBonding: (v: number) => void;
  simRealStopLossPumpSwap: number;
  setSimRealStopLossPumpSwap: (v: number) => void;
  simRealStopLossUnknown: number;
  setSimRealStopLossUnknown: (v: number) => void;
"""
    content = content.replace(props_type_old.strip(), props_type_new.strip())

    # 2. Destructuring
    props_destruct_old = """
  simRealTakeProfit,
  setSimRealTakeProfit,
  simRealStopLoss,
  setSimRealStopLoss,
"""
    props_destruct_new = """
  simRealTakeProfitRaydium,
  setSimRealTakeProfitRaydium,
  simRealTakeProfitBonding,
  setSimRealTakeProfitBonding,
  simRealStopLossRaydium,
  setSimRealStopLossRaydium,
  simRealStopLossBonding,
  setSimRealStopLossBonding,
  simRealStopLossPumpSwap,
  setSimRealStopLossPumpSwap,
  simRealStopLossUnknown,
  setSimRealStopLossUnknown,
"""
    content = content.replace(props_destruct_old.strip(), props_destruct_new.strip())

    # 3. useEffect auto-sell logic
    logic_old = """
      const tpLimit = (simRealTakeProfit !== undefined ? simRealTakeProfit : 10) / 100;
      const slLimit = (simRealStopLoss !== undefined ? simRealStopLoss : -10) / 100;

      for (const pos of activeSimrealPositions) {
         if (!pos || !pos.simRealBought) continue;
         
         const mint = Object.keys(positions).find(k => positions[k] === pos);
         if (!mint) continue;
"""
    logic_new = """
      for (const pos of activeSimrealPositions) {
         if (!pos || !pos.simRealBought) continue;
         
         const mint = Object.keys(positions).find(k => positions[k] === pos);
         if (!mint) continue;
         
         const tokenMetric = tokenMetrics[mint];
         const stageInfo = tokenMetric ? detectTokenStage(tokenMetric) : { type: 'UNKNOWN', isRaydiumListed: false };
         
         let tpLimit = 0.50; // default 50%
         let slLimit = -0.15; // default -15%
         
         if (stageInfo.type === 'PUMP_FUN_RAYDIUM' || stageInfo.isRaydiumListed) {
             tpLimit = (simRealTakeProfitRaydium !== undefined ? simRealTakeProfitRaydium : 50) / 100;
             slLimit = (simRealStopLossRaydium !== undefined ? simRealStopLossRaydium : -15) / 100;
         } else if (stageInfo.type === 'PUMP_FUN_BONDING') {
             tpLimit = (simRealTakeProfitBonding !== undefined ? simRealTakeProfitBonding : 100) / 100;
             slLimit = (simRealStopLossBonding !== undefined ? simRealStopLossBonding : -20) / 100;
         } else if (stageInfo.type === 'PUMP_SWAP') {
             tpLimit = (simRealTakeProfitRaydium !== undefined ? simRealTakeProfitRaydium : 50) / 100; // No specific PumpSwap TP provided by user, reusing Raydium or Bonding? Wait, we can reuse bonding since it's pre-raydium
             slLimit = (simRealStopLossPumpSwap !== undefined ? simRealStopLossPumpSwap : -15) / 100;
         } else {
             tpLimit = (simRealTakeProfitRaydium !== undefined ? simRealTakeProfitRaydium : 50) / 100;
             slLimit = (simRealStopLossUnknown !== undefined ? simRealStopLossUnknown : -20) / 100;
         }
"""
    content = content.replace(logic_old.strip(), logic_new.strip())

    deps_old = "positions, simRealTakeProfit, simRealStopLoss, privateKey, slippage, executeSimRealSell"
    deps_new = "positions, tokenMetrics, simRealTakeProfitRaydium, simRealTakeProfitBonding, simRealStopLossRaydium, simRealStopLossBonding, simRealStopLossPumpSwap, simRealStopLossUnknown, privateKey, slippage, executeSimRealSell"
    content = content.replace(deps_old, deps_new)

    # 4. Settings UI
    settings_ui_old = """
                <div className="grid grid-cols-2 gap-3">
                   <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center">
                         <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Take Profit</label>
                         <span className="text-[9px] text-emerald-400 font-mono">%</span>
                      </div>
                      <input
                         type="number"
                         value={simRealTakeProfit}
                         onChange={(e) => setSimRealTakeProfit(Number(e.target.value))}
                         className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                      />
                   </div>
                   <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center">
                         <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Stop Loss</label>
                         <span className="text-[9px] text-rose-400 font-mono">%</span>
                      </div>
                      <input
                         type="number"
                         value={simRealStopLoss}
                         onChange={(e) => setSimRealStopLoss(-Math.abs(Number(e.target.value)))}
                         className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                      />
                   </div>
                </div>
"""
    settings_ui_new = """
                <div className="space-y-3">
                   <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">TP (Raydium)</label>
                            <span className="text-[9px] text-emerald-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealTakeProfitRaydium}
                            onChange={(e) => setSimRealTakeProfitRaydium(Number(e.target.value))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">SL (Raydium)</label>
                            <span className="text-[9px] text-rose-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealStopLossRaydium}
                            onChange={(e) => setSimRealStopLossRaydium(-Math.abs(Number(e.target.value)))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                   </div>
                   
                   <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">TP (Bonding)</label>
                            <span className="text-[9px] text-emerald-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealTakeProfitBonding}
                            onChange={(e) => setSimRealTakeProfitBonding(Number(e.target.value))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">SL (Bonding)</label>
                            <span className="text-[9px] text-rose-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealStopLossBonding}
                            onChange={(e) => setSimRealStopLossBonding(-Math.abs(Number(e.target.value)))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                   </div>

                   <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">SL (PumpSwap)</label>
                            <span className="text-[9px] text-rose-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealStopLossPumpSwap}
                            onChange={(e) => setSimRealStopLossPumpSwap(-Math.abs(Number(e.target.value)))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                      <div className="flex flex-col gap-1">
                         <div className="flex justify-between items-center">
                            <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">SL (Unknown)</label>
                            <span className="text-[9px] text-rose-400 font-mono">%</span>
                         </div>
                         <input
                            type="number"
                            value={simRealStopLossUnknown}
                            onChange={(e) => setSimRealStopLossUnknown(-Math.abs(Number(e.target.value)))}
                            className="bg-[#07080e] border border-[#1f212e] rounded-lg px-3 py-1.5 text-xs text-[#e2e8f0] focus:outline-none focus:border-emerald-500/50 font-mono w-full"
                         />
                      </div>
                   </div>
                </div>
"""
    content = content.replace(settings_ui_old.strip(), settings_ui_new.strip())

    with open('src/components/pages/SimRealPage.tsx', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    try:
        patch_app_tsx()
        patch_pnl_page()
        patch_simreal_page()
        print("Patched successfully")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
