const fs = require('fs');
let content = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

// Replace pumpSwapStopLoss props with both
content = content.replace(/pumpSwapStopLoss\?: number;/g, 'pumpSwapStopLoss?: number;\n    pumpSwapTakeProfit?: number;\n    setPumpSwapTakeProfit?: (val: number) => void;');
content = content.replace(/pumpSwapStopLoss = -15, setPumpSwapStopLoss = \(\) => \{\},/g, 'pumpSwapStopLoss = -15, setPumpSwapStopLoss = () => {},\n    pumpSwapTakeProfit = 25, setPumpSwapTakeProfit = () => {},');
content = content.replace(/const pumpSwapStopLossPct = Math\.abs\(pumpSwapStopLoss\);/g, 'const pumpSwapStopLossPct = Math.abs(pumpSwapStopLoss);\n  const pumpSwapTakeProfitPct = Math.abs(pumpSwapTakeProfit);');
content = content.replace(/pumpSwapStopLossPct, unknownStopLossPct/g, 'pumpSwapStopLossPct, pumpSwapTakeProfitPct, unknownStopLossPct');

// Add TP calculation inside the positions map
content = content.replace(/let activeTP = minTakeProfit;/g, `let activeTP = minTakeProfit;
                      if (pos.recoveryMode) {
                        activeTP = bondingCurveTakeProfit;
                      } else if (pos.symbol?.toLowerCase().endsWith('pump')) {
                        activeTP = pumpSwapTakeProfit;
                      }`);

// Add to UI
const slHtml = `<div className="space-y-2">
                <label className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">PumpSwap/Graduated</label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-mono text-[12px]">-</span>
                  <input type="number" value={pumpSwapStopLossPct} onChange={(e) => setPumpSwapStopLoss(-Math.abs(Number(e.target.value)))} className="w-full bg-[#050509] border border-[#2d2e3d] rounded-lg px-3 py-2 text-[13px] text-white font-mono focus:outline-none focus:border-[#c7f284] transition-colors" id="input-sl-pumpswap" />
                  <span className="text-slate-400 font-mono text-[12px]">%</span>
                </div>
              </div>`;

const tpToAdd = `<div className="space-y-2">
                <label className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">PumpSwap/Graduated</label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-mono text-[12px]">+</span>
                  <input type="number" value={pumpSwapTakeProfitPct} onChange={(e) => setPumpSwapTakeProfit(Math.abs(Number(e.target.value)))} className="w-full bg-[#050509] border border-[#2d2e3d] rounded-lg px-3 py-2 text-[13px] text-white font-mono focus:outline-none focus:border-[#c7f284] transition-colors" />
                  <span className="text-slate-400 font-mono text-[12px]">%</span>
                </div>
              </div>`;
              
const tpRegex = /<label className="text-\[11px\] uppercase tracking-wider text-slate-500 font-bold">Bonding Curve \/ Phase 1<\/label>\s*<div className="flex items-center gap-2">\s*<span className="text-slate-400 font-mono text-\[12px\]">\+<\/span>\s*<input type="number" value=\{bondingCurveTakeProfitPct\}.*?\/>\s*<span className="text-slate-400 font-mono text-\[12px\]">%<\/span>\s*<\/div>\s*<\/div>/;

content = content.replace(tpRegex, match => match + '\n              ' + tpToAdd);

fs.writeFileSync('src/components/pages/PnLPage.tsx', content);
console.log('PnLPage.tsx patched for pumpSwapTakeProfit');
