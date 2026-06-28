const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Change buyAmountSol default
content = content.replace(
  'const [buyAmountSol, setBuyAmountSol] = useState(1);',
  'const [buyAmountSol, setBuyAmountSol] = useState(0.5);'
);

// Modify UI for Stop Loss / Target Profit
const uiUpdate = `
                <div className="flex justify-between items-center text-[10px] font-bold mt-4 mb-1">
                  <span className="text-slate-500 uppercase">100x Moonbag Strategy</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <div 
                    onClick={() => setMoonbagStrategy(!moonbagStrategy)}
                    className={"w-10 h-5 rounded-full p-1 cursor-pointer transition-colors relative " + (moonbagStrategy ? "bg-emerald-500" : "bg-slate-700")}
                  >
                    <div className={"w-3 h-3 bg-white rounded-full transition-transform " + (moonbagStrategy ? "translate-x-5" : "")} />
                  </div>
                  <span className="text-xs text-slate-400">
                    {moonbagStrategy ? 'Active: 2x pull principal, 10x pull 50%, hold moonbag' : 'Inactive: Sell all at profit target'}
                  </span>
                </div>
                
                <div className="flex justify-between items-center text-[10px] font-bold mt-4 mb-1">
                  <span className="text-slate-500 uppercase">Max Slippage</span>
`;

content = content.replace(
  `                <div className="flex justify-between items-center text-[10px] font-bold mt-4 mb-1">
                  <span className="text-slate-500 uppercase">Max Slippage</span>`,
  uiUpdate
);

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log("UI updated");
