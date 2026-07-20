const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Add states
content = content.replace(
  "  const [sectorFilter, setSectorFilter] = useState",
  "  const [manualGemInput, setManualGemInput] = useState('');\n  const [isAddingGem, setIsAddingGem] = useState(false);\n  const [sectorFilter, setSectorFilter] = useState"
);

// Add handle function
const toggleSaveGemCode = `  const toggleSaveGem = (item: TokenMetric | string) => {`;
const manualAddCode = `  const handleManualAddGem = async () => {
    const address = manualGemInput.trim();
    if (!address) {
      addNotification('Please enter a valid token address');
      return;
    }
    if (savedGems[address]) {
      addNotification('Token is already in Moonshots');
      return;
    }
    setIsAddingGem(true);
    addNotification('Fetching token data...');
    try {
      const security = await fetchTokenSecurityData(address);
      if (security && security.security && security.security.symbol) {
        const symbol = security.security.symbol;
        const fakeMetric = { address, symbol, priceUsd: security.priceUsd };
        toggleSaveGem({ ...fakeMetric } as any);
        setManualGemInput('');
        addNotification(\`Added \${symbol} to Moonshots\`);
      } else {
        addNotification('Could not fetch token metadata. Adding address only.');
        toggleSaveGem({ address, symbol: 'UNKNOWN', priceUsd: security?.priceUsd || 0 } as any);
        setManualGemInput('');
      }
    } catch (e) {
      console.error(e);
      addNotification('Failed to add token');
    } finally {
      setIsAddingGem(false);
    }
  };

  const toggleSaveGem = (item: TokenMetric | string) => {`;
content = content.replace(toggleSaveGemCode, manualAddCode);

// Add UI in Strategy Portfolio
const strategyHeaderTarget = `            <div className="flex flex-wrap items-center gap-2 mt-4">`;
const strategyHeaderReplacement = `            <div className="flex flex-wrap items-center gap-2 mt-4">
              <div className="flex items-center gap-2 mr-2">
                <input
                  type="text"
                  placeholder="Paste Token Address..."
                  value={manualGemInput}
                  onChange={(e) => setManualGemInput(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-white text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full outline-none focus:border-indigo-500 w-48 placeholder:text-slate-600"
                />
                <button
                  onClick={handleManualAddGem}
                  disabled={isAddingGem || !manualGemInput.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-[10px] font-black tracking-widest px-4 py-1.5 rounded-full transition-all flex items-center gap-1"
                >
                  {isAddingGem ? <Scan className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  ADD
                </button>
              </div>`;
content = content.replace(strategyHeaderTarget, strategyHeaderReplacement);

// Make sure Plus icon is imported
if (!content.includes('Plus,')) {
  content = content.replace('import { Play, ', 'import { Play, Plus, ');
}

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log("Added manual add gem feature");
