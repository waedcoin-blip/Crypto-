const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Insert moonbag state
content = content.replace(
  'const [profitTarget, setProfitTarget] = useState(100); // 2x profit',
  `const [profitTarget, setProfitTarget] = useState(100); // 2x profit\n  const [moonbagStrategy, setMoonbagStrategy] = useState(true);`
);

// Add moonbagStrategy to latestState
content = content.replace(
  'const latestState = useRef({ tokenMetrics, autoSniperEnabled, profitTarget, stopLoss, activePositions, slippage });',
  'const latestState = useRef({ tokenMetrics, autoSniperEnabled, profitTarget, stopLoss, activePositions, slippage, moonbagStrategy });'
);
content = content.replace(
  'latestState.current = { tokenMetrics, autoSniperEnabled, profitTarget, stopLoss, activePositions, slippage };',
  'latestState.current = { tokenMetrics, autoSniperEnabled, profitTarget, stopLoss, activePositions, slippage, moonbagStrategy };'
);

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log("State updated");
