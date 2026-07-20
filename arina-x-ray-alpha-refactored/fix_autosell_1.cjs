const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add telegram bot states
content = content.replace(
  "const [slippage, setSlippage] = useState(15.0); // 15% slippage for memes",
  `const [slippage, setSlippage] = useState(1.0); // Slippage
  const [telegramBotToken, setTelegramBotToken] = useState(() => localStorage.getItem('tg_bot_token') || '');
  const [telegramChatId, setTelegramChatId] = useState(() => localStorage.getItem('tg_chat_id') || '');`
);

// 2. Add default profitTarget = 50
content = content.replace(
  "const [profitTarget, setProfitTarget] = useState(100);",
  "const [profitTarget, setProfitTarget] = useState(50);" 
);


// 3. Add sendTelegramMessage function
const tgFunc = `
  const sendTelegramAlert = async (msg: string) => {
    if (!telegramBotToken || !telegramChatId) return;
    try {
      fetch(\`https://api.telegram.org/bot\${telegramBotToken}/sendMessage\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramChatId, text: msg, parse_mode: 'HTML' })
      });
    } catch {}
  };
`;
content = content.replace(
  "const [profitTarget, setProfitTarget] = useState(50);",
  "const [profitTarget, setProfitTarget] = useState(50);\n" + tgFunc
);

// 4. Update fns.current to include sendTelegramAlert and telegram logic
content = content.replace(
  "latestState.current = { tokenMetrics, autoSniperEnabled, profitTarget, stopLoss, activePositions, slippage, moonbagStrategy };",
  "latestState.current = { tokenMetrics, autoSniperEnabled, profitTarget, stopLoss, activePositions, slippage, moonbagStrategy, telegramBotToken, telegramChatId };"
);

content = content.replace(
  "fns.current = { executeAutoSell, executeAutoTrade };",
  "fns.current = { executeAutoSell, executeAutoTrade, executePartialSell, sendTelegramAlert };"
);

// 5. Update moonbag logic
const updatedLogic = `          if (state.moonbagStrategy) {
            if (currentPnL >= 900 && !position.hasPulled10x) {
              console.log(\`[EXIT] Pulling 50% at 10x for \${token.symbol}\`);
              fns.current.executePartialSell(token.address, token.symbol, 0.5, 'hasPulled10x');
            } else if (currentPnL >= state.profitTarget && !position.hasPulledPrincipal) {
              console.log(\`[EXIT] Pulling Principal at \${state.profitTarget}% for \${token.symbol}\`);
              const initialCapFraction = 1 / (1 + (currentPnL / 100));
              fns.current.executePartialSell(token.address, token.symbol, initialCapFraction, 'hasPulledPrincipal');
            } else if (currentPnL <= state.stopLoss) {
              console.log(\`[EXIT] Stop Loss for \${token.symbol}\`);
              fns.current.executeAutoSell(token.address, token.symbol);
            }
          } else {
            if (currentPnL >= state.profitTarget || currentPnL <= state.stopLoss) {
              const reason = currentPnL >= state.profitTarget ? "Take Profit" : "Stop Loss";
              console.log(\`[EXIT] \${reason} for \${token.symbol}: \${currentPnL.toFixed(2)}% (Real)\`);
              fns.current.executeAutoSell(token.address, token.symbol);
            }
          }`;

const regex = /          if \(state\.moonbagStrategy\) \{[\s\S]*?\} else \{\s*\n\s*if \(currentPnL >= state\.profitTarget \|\| currentPnL <= state\.stopLoss\) \{[\s\S]*?\}\s*\}/;

content = content.replace(regex, updatedLogic);

fs.writeFileSync('src/App.tsx', content, 'utf8');
