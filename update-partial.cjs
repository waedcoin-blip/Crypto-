const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const targetBlock = `  const executeAutoSell = async (tokenAddress: string, symbol: string) => {`;

const replacementBlock = `  const executePartialSell = async (tokenAddress: string, symbol: string, percent: number, flag: string) => {
    const position = activePositions[tokenAddress];
    if (!position) return;
    setTradingStatus(\`Partial Sell \${symbol} (\${percent*100}%)...\`);
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      setActivePositions(prev => {
        const p = prev[tokenAddress];
        if (!p) return prev;
        return {
          ...prev,
          [tokenAddress]: {
            ...p,
            amount: p.amount * (1 - percent),
            [flag]: true
          }
        };
      });
      addNotification(\`Sold \${percent*100}% of \${symbol} successfully.\`);
      setTradingStatus('Idle');
    } catch (e) {
      console.error(e);
      addNotification(\`Sell failed for \${symbol}\`);
      setTradingStatus('Idle');
    }
  };

  const executeAutoSell = async (tokenAddress: string, symbol: string) => {`;

content = content.replace(targetBlock, replacementBlock);

// also add to fns.current
content = content.replace(
  'fns.current = { executeAutoSell, executeAutoBuy };',
  'fns.current = { executeAutoSell, executeAutoBuy, executePartialSell };'
);

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log("Partial sell added");
