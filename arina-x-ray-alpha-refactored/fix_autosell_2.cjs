const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Inject into executeAutoTrade
content = content.replace(
  "setActivePositions(prev => ({",
  `if (sendTelegramAlert) sendTelegramAlert(\`🟢 <b>BUY Execution</b>\\nToken: \${symbol}\\nAmount: \${buyAmountSol} SOL\`);\n      setActivePositions(prev => ({`
);

// Inject into executeAutoSell
content = content.replace(
  "const finalPnL = ((currentVal / initialSol) - 1) * 100;",
  `const finalPnL = ((currentVal / initialSol) - 1) * 100;\n        if (sendTelegramAlert) sendTelegramAlert(\`🔴 <b>SELL Execution</b>\\nToken: \${symbol}\\nPnL: 👀 \${finalPnL.toFixed(2)}%\\nAmount: \${currentVal.toFixed(4)} SOL\`);`
);

// Inject into executePartialSell
content = content.replace(
  /setActivePositions\(prev => \{/g,
  `if (sendTelegramAlert) sendTelegramAlert(\`🟡 <b>PARTIAL SELL (\${(percent*100).toFixed(0)}%)</b>\\nToken: \${symbol}\`);\n      setActivePositions(prev => {`
);

// Make sure we define it outside, wait, `sendTelegramAlert` is defined in `App` component so it is in scope for `executeAutoSell` etc.

// Wait, the regex might replace too many setActivePositions for partial sell. Let's do it specifically.
// Revert the executePartialSell and be more specific
content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(
  "setActivePositions(prev => ({",
  `if (sendTelegramAlert) sendTelegramAlert(\`🟢 <b>BUY Execution</b>\\nToken: \${symbol}\\nAmount: \${buyAmountSol} SOL\`);\n      setActivePositions(prev => ({`
);

content = content.replace(
  "const finalPnL = ((currentVal / initialSol) - 1) * 100;",
  `const finalPnL = ((currentVal / initialSol) - 1) * 100;\n        if (sendTelegramAlert) sendTelegramAlert(\`🔴 <b>SELL Execution</b>\\nToken: \${symbol}\\nPnL: 👀 \${finalPnL.toFixed(2)}%\\nAmount: \${currentVal.toFixed(4)} SOL\`);`
);

content = content.replace(
  "setTradingStatus(`Partial Sell ${symbol} (${percent*100}%)...`);",
  "setTradingStatus(`Partial Sell ${symbol} (${percent*100}%)...`);\n    if (sendTelegramAlert) sendTelegramAlert(`🟡 <b>PARTIAL SELL (${(percent*100).toFixed(0)}%)</b>\\nToken: ${symbol}`);"
);


// Add telegram settings interface in UI
const tgUI = `
            <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/50 mb-6">
              <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-3">Telegram Bot Integration</h4>
              <div className="space-y-3">
                <div>
                  <input
                    type="password"
                    placeholder="Bot Token"
                    value={telegramBotToken}
                    onChange={(e) => {
                      setTelegramBotToken(e.target.value);
                      localStorage.setItem('tg_bot_token', e.target.value);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <input
                    type="text"
                    placeholder="Chat ID"
                    value={telegramChatId}
                    onChange={(e) => {
                      setTelegramChatId(e.target.value);
                      localStorage.setItem('tg_chat_id', e.target.value);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
                <button
                  onClick={() => sendTelegramAlert('🔔 <b>Matrix Test Alert</b>\\nYour Telegram bot is successfully connected!')}
                  className="w-full bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 font-black uppercase text-[9px] tracking-widest py-2 rounded-lg transition-colors"
                >
                  Test Connection
                </button>
              </div>
            </div>
`;

// Insert before the generic configuration
content = content.replace(
  '<h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-3 flex items-center gap-2">',
  tgUI + '\n<h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-3 flex items-center gap-2">'
);


// Change UI to show accurate moonbag text
content = content.replace(
  "{moonbagStrategy ? 'Active: 2x pull principal, 10x pull 50%, hold moonbag' : 'Inactive: Sell all at profit target'}",
  "{moonbagStrategy ? `Active: ${profitTarget}% profit pull principal, 10x pull 50%, hold moonbag` : 'Inactive: Sell all at profit target'}"
);

// We need an array for slippage fast settings. 1%, 2%, 3%. Let's update the slippage input.
const slippageUI = `
                <div className="flex gap-2 mb-3">
                  {[1, 2, 3].map(val => (
                    <button
                      key={val}
                      onClick={() => setSlippage(val)}
                      className={"flex-1 py-1 rounded border text-[10px] font-black transition-colors " + (slippage === val ? "bg-indigo-600 border-indigo-500 text-white" : "bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300")}
                    >{val}%</button>
                  ))}
                </div>
`;
content = content.replace(
  '<p className="text-[8px] text-slate-600 mt-1 uppercase tracking-tighter italic">Includes Price Impact + Fixed Fees</p>',
  slippageUI + '\n<p className="text-[8px] text-slate-600 mt-1 uppercase tracking-tighter italic">Includes Price Impact + Fixed Fees</p>'
);

fs.writeFileSync('src/App.tsx', content, 'utf8');
