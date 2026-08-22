const fs = require('fs');

// --- 1. Fix criteriaService.ts ---
let criteria = fs.readFileSync('server/services/criteriaService.ts', 'utf8');
if (!criteria.includes('pumpSwapTakeProfit: z.coerce.number()')) {
    criteria = criteria.replace(
        /bondingCurveTakeProfit: z\.coerce\.number\(\)\.optional\(\),/g,
        'bondingCurveTakeProfit: z.coerce.number().optional(),\n  pumpSwapTakeProfit: z.coerce.number().optional(),'
    );
}
if (!criteria.includes('pumpSwapTakeProfit: 25')) {
    criteria = criteria.replace(
        /bondingCurveTakeProfit: 25,/g,
        'bondingCurveTakeProfit: 25,\n  pumpSwapTakeProfit: 25,'
    );
}
fs.writeFileSync('server/services/criteriaService.ts', criteria);
console.log('✅ criteriaService.ts patched');

// --- 2. Fix App.tsx (Hydration Race Condition) ---
let appTsx = fs.readFileSync('src/App.tsx', 'utf8');
// Replace useRef with useState
appTsx = appTsx.replace(
    /const isFirestoreLoading = useRef\(true\);/g,
    "const [settingsHydrationStatus, setSettingsHydrationStatus] = useState<'idle'|'loading'|'hydrated'>('idle');"
);
// Replace .current assignments
appTsx = appTsx.replace(
    /isFirestoreLoading\.current = true;/g,
    "setSettingsHydrationStatus('loading');"
);
appTsx = appTsx.replace(
    /isFirestoreLoading\.current = false;/g,
    "setSettingsHydrationStatus('hydrated');"
);
appTsx = appTsx.replace(
    /if \(isFirestoreLoading\.current\) return;/g,
    "if (settingsHydrationStatus !== 'hydrated') return;"
);
fs.writeFileSync('src/App.tsx', appTsx);
console.log('✅ App.tsx patched');

// --- 3. Fix PnLPage.tsx (Hydration Race & PumpSwap TP UI) ---
let pnl = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');
// Hydration fix
pnl = pnl.replace(
    /const isFirestoreLoading = useRef\(true\);/g,
    "const [settingsHydrationStatus, setSettingsHydrationStatus] = useState<'idle'|'loading'|'hydrated'>('idle');"
);
pnl = pnl.replace(
    /isFirestoreLoading\.current = true;/g,
    "setSettingsHydrationStatus('loading');"
);
pnl = pnl.replace(
    /isFirestoreLoading\.current = false;/g,
    "setSettingsHydrationStatus('hydrated');"
);
pnl = pnl.replace(
    /if \(isFirestoreLoading\.current\) \{/g,
    "if (settingsHydrationStatus !== 'hydrated') {"
);

// UI Addition for PumpSwap Take Profit
const stopLossUI = `<label className="text-xs text-slate-400 font-medium font-sans">Stop Loss (PumpSwap)</label>
                                    <div className="relative">
                                        <input type="number" 
                                               className="w-full bg-[#0a0e17] border border-slate-800/60 rounded-md py-1.5 px-3 text-sm text-slate-200 outline-none focus:border-[#4ade80]/50 focus:ring-1 focus:ring-[#4ade80]/20 transition-all font-mono"
                                               value={pumpSwapStopLoss}
                                               onChange={e => setPumpSwapStopLoss(Number(e.target.value))}
                                               placeholder="10" />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">%</span>
                                    </div>`;

const tpUI = `<label className="text-xs text-slate-400 font-medium font-sans">Take Profit (PumpSwap)</label>
                                    <div className="relative">
                                        <input type="number" 
                                               className="w-full bg-[#0a0e17] border border-slate-800/60 rounded-md py-1.5 px-3 text-sm text-slate-200 outline-none focus:border-[#4ade80]/50 focus:ring-1 focus:ring-[#4ade80]/20 transition-all font-mono"
                                               value={pumpSwapTakeProfit}
                                               onChange={e => setPumpSwapTakeProfit(Number(e.target.value))}
                                               placeholder="25" />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">%</span>
                                    </div>`;

if (pnl.includes(stopLossUI) && !pnl.includes('Take Profit (PumpSwap)')) {
    pnl = pnl.replace(stopLossUI, tpUI + '\n                                </div>\n                                <div className="space-y-1.5">\n                                    ' + stopLossUI);
}
fs.writeFileSync('src/components/pages/PnLPage.tsx', pnl);
console.log('✅ PnLPage.tsx patched');

// --- 4. Fix DevnetAmmExecutor.ts ---
let devnet = fs.readFileSync('src/services/DevnetAmmExecutor.ts', 'utf8');
const bugStr = `      const targetTokenMintStr = isSolBuy ? outputMint : inputMint;
      let preTradeTokenBalance = 0;
      if (targetTokenMintStr !== 'So11111111111111111111111111111111111111112') {
         preTradeTokenBalance = await this.getTokenBalance(targetTokenMintStr);
      }`;
// We need to move the definition of targetTokenMintStr so it's accessible in the lower block
// Actually, I'll just change the lower block to redefine it, or change the scope.
devnet = devnet.replace(/const targetTokenMintStr = isSolBuy \? outputMint : inputMint;/g, 'var targetTokenMintStr = isSolBuy ? outputMint : inputMint;');
devnet = devnet.replace(/let preTradeTokenBalance = 0;/g, 'var preTradeTokenBalance = 0;');

fs.writeFileSync('src/services/DevnetAmmExecutor.ts', devnet);
console.log('✅ DevnetAmmExecutor.ts patched');

