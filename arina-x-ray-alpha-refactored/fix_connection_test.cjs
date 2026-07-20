const fs = require('fs');

let content = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');

// Add states
content = content.replace(
  "const [maxPositions, setMaxPositions] = useState(() => Number(localStorage.getItem('juipter_auto_maxPositions')) || 1);",
  "const [maxPositions, setMaxPositions] = useState(() => Number(localStorage.getItem('juipter_auto_maxPositions')) || 1);\n  const [slippage, setSlippage] = useState(() => Number(localStorage.getItem('juipter_auto_slippage')) || 2.0);\n  const [connectionStatus, setConnectionStatus] = useState<'idle'|'testing'|'success'|'error'>('idle');\n  const [connectionMessage, setConnectionMessage] = useState('');"
);

// Add testConnection function
const testConnectionFunc = `
  const testConnection = async () => {
    setConnectionStatus('testing');
    setConnectionMessage('Testing connection...');
    try {
      if (!privateKey) throw new Error('Private key is required.');
      const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
      const conn = new Connection(rpcUrl);
      const balance = await conn.getBalance(keypair.publicKey);
      
      // Test Jupiter API too
      const baseUrl = apiKey && apiKey.startsWith('http') ? apiKey : (apiKey ? \`https://\${apiKey}\` : 'https://quote-api.jup.ag');
      const quoteUrl = \`\${baseUrl}/v6/quote?inputMint=\${SOL_MINT}&outputMint=\${USDC_MINT}&amount=1000000000&slippageBps=\${Math.floor(slippage * 100)}\`;
      const quoteResponse = await (await fetch(quoteUrl)).json();
      
      if (quoteResponse.error) throw new Error('Jupiter API error: ' + quoteResponse.error);

      setConnectionMessage(\`Success! Balance: \${(balance / 1e9).toFixed(4)} SOL | Jupiter: OK\`);
      setConnectionStatus('success');
    } catch (e: any) {
      setConnectionStatus('error');
      setConnectionMessage(e.message || 'Connection failed.');
    }
  };
`;

content = content.replace(
  "const testConnection = undefined;", // Ensure it doesn't exist already
  ""
);

// Put it before `const executeJupiterSwap`
content = content.replace(
  "const executeJupiterSwap = async",
  testConnectionFunc + "\n  const executeJupiterSwap = async"
);

// Replace executeJupiterSwap url construction with slippage dynamically
content = content.replace(
  "const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(amount)}&slippageBps=200`;",
  "const baseUrl = apiKey && apiKey.startsWith('http') ? apiKey : (apiKey ? `https://${apiKey}` : 'https://quote-api.jup.ag');\n    const quoteUrl = `${baseUrl}/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(amount)}&slippageBps=${Math.floor(slippage * 100)}`;"
);

content = content.replace(
  "const swapTxResp = await (await fetch('https://quote-api.jup.ag/v6/swap'",
  "const swapTxResp = await (await fetch(`${baseUrl}/v6/swap`"
);


// Replace the apiKey input area
const apiKeyInput = `<div>
                <div className="flex justify-between text-[11px] text-[#64748b] mb-1.5 uppercase font-medium"><span>Jupiter API Key</span></div>
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="portal.jup.ag (Optional)" className="w-full bg-[#050509] border border-[#2d2e3d] rounded-lg px-3 py-2 text-[13px] text-white font-mono focus:outline-none focus:border-[#c7f284] transition-colors" />
              </div>`;

const extraInputs = `<div>
                <div className="flex justify-between text-[11px] text-[#64748b] mb-1.5 uppercase font-medium"><span>Jupiter API URL / Key</span></div>
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="https://premium.jup.ag (Optional)" className="w-full bg-[#050509] border border-[#2d2e3d] rounded-lg px-3 py-2 text-[13px] text-white font-mono focus:outline-none focus:border-[#c7f284] transition-colors" />
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-[#64748b] mb-1.5 uppercase font-medium"><span>Wallet Private Key</span></div>
                <input type="password" value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} placeholder="Base58 private key" className="w-full mb-3 bg-[#050509] border border-[#2d2e3d] rounded-lg px-3 py-2 text-[13px] text-white font-mono focus:outline-none focus:border-[#c7f284] transition-colors" />
                
                <div className="flex items-center justify-between gap-3 relative">
                  <div className="flex-1">
                    <label className="text-[11px] text-[#64748b] mb-1.5 uppercase font-medium block">Slippage (%)</label>
                    <input type="number" step="0.1" value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} className="w-full bg-[#050509] border border-[#2d2e3d] rounded-lg px-3 py-2 text-[13px] text-white font-mono focus:outline-none focus:border-[#c7f284] transition-colors" />
                  </div>
                  <div className="flex-1 flex flex-col justify-end">
                    <button 
                      onClick={testConnection} 
                      className="w-full bg-[#1b1c26] hover:bg-[#2d2e3d] border border-[#2d2e3d] text-[#c7f284] text-[12px] font-bold py-2 rounded-lg transition-colors flex items-center justify-center gap-2 mt-auto h-[38px]"
                    >
                      {connectionStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                    </button>
                  </div>
                </div>
                {connectionMessage && (
                  <div className={\`mt-2 px-3 py-2 text-[11px] rounded-lg font-mono \${connectionStatus === 'success' ? 'bg-[#c7f284]/10 text-[#c7f284]' : 'bg-rose-500/10 text-rose-400'}\`}>
                    {connectionMessage}
                  </div>
                )}
              </div>`;

content = content.replace(apiKeyInput + `\n              <div>\n                <div className="flex justify-between text-[11px] text-[#64748b] mb-1.5 uppercase font-medium"><span>Wallet Private Key</span></div>\n                <input type="password" value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} placeholder="Base58 private key" className="w-full bg-[#050509] border border-[#2d2e3d] rounded-lg px-3 py-2 text-[13px] text-white font-mono focus:outline-none focus:border-[#c7f284] transition-colors" />\n              </div>`, extraInputs);

fs.writeFileSync('src/components/pages/PnLPage.tsx', content);

