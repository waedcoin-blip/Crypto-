const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const tgUI = `            <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/50 mb-6">
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
            </div>`;

content = content.replace(
  '<button \n              onClick={() => setAutoSniperEnabled(!autoSniperEnabled)}',
  tgUI + '\n            <button \n              onClick={() => setAutoSniperEnabled(!autoSniperEnabled)}'
);

fs.writeFileSync('src/App.tsx', content, 'utf8');
