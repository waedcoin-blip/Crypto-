import re

# 1. Update WalletStatusWidget.tsx
with open('src/components/WalletStatusWidget.tsx', 'r') as f:
    content = f.read()

# Add states inside component
state_insertion = """  const [showKeyForm, setShowKeyForm] = useState(false);
  const [inputKey, setInputKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [keySuccess, setKeySuccess] = useState('');

  const handleUpdateKeySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setKeyError('');
    setKeySuccess('');
    const raw = inputKey.trim();
    if (!raw) {
      setKeyError('Please enter a private key');
      return;
    }
    try {
      let secretKeyUint8: Uint8Array;
      if (raw.startsWith('[') && raw.endsWith(']')) {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length !== 64) {
          throw new Error('Secret key array must be 64 bytes long');
        }
        secretKeyUint8 = new Uint8Array(parsed);
      } else {
        secretKeyUint8 = bs58.decode(raw);
        if (secretKeyUint8.length !== 64) {
          throw new Error('Base58 private key must decode to 64 bytes');
        }
      }
      const kp = Keypair.fromSecretKey(secretKeyUint8);
      const encoded = bs58.encode(kp.secretKey);
      sessionStorage.setItem('matrix_session_key', encoded);
      localStorage.setItem('juipter_auto_privateKey', encoded);
      setSessionWallet(kp);

      useBalanceStore.getState().setWalletAddress(kp.publicKey.toBase58());
      const service = new WalletBalanceService(network);
      service.refresh(kp.publicKey.toBase58());

      setKeySuccess(`Wallet updated! Address: ${kp.publicKey.toBase58().slice(0, 4)}...${kp.publicKey.toBase58().slice(-4)}`);
      setInputKey('');
      setTimeout(() => {
        setKeySuccess('');
        setShowKeyForm(false);
      }, 2000);
    } catch (err: any) {
      setKeyError(err.message || 'Invalid Base58 or JSON private key');
    }
  };
"""

target_state_anchor = "const [copied, setCopied] = useState(false);"
if target_state_anchor in content and "handleUpdateKeySubmit" not in content:
    content = content.replace(target_state_anchor, target_state_anchor + "\n" + state_insertion)

# Add Update Key section before Address Row in dropdown
update_key_ui = """              {/* Key Management Row */}
              <div className="mb-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Wallet Key Management</div>
                  <button
                    type="button"
                    onClick={() => setShowKeyForm(!showKeyForm)}
                    className="text-[10px] font-bold text-amber-400 hover:text-amber-300 underline cursor-pointer flex items-center gap-1"
                  >
                    <Key className="w-3 h-3" />
                    {showKeyForm ? 'Cancel' : 'Update Wallet Key'}
                  </button>
                </div>

                {showKeyForm && (
                  <form onSubmit={handleUpdateKeySubmit} className="p-2.5 rounded-xl bg-slate-900 border border-amber-500/30 space-y-2">
                    <div className="text-[10px] text-slate-300 font-medium">
                      Enter Base58 private key or 64-byte JSON array:
                    </div>
                    <textarea
                      rows={2}
                      value={inputKey}
                      onChange={(e) => setInputKey(e.target.value)}
                      placeholder="Paste Base58 private key or [12,34,...]"
                      className="w-full text-[11px] font-mono p-2 rounded-lg bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60"
                    />
                    {keyError && (
                      <div className="text-[10px] font-semibold text-rose-400 bg-rose-950/40 p-1.5 rounded border border-rose-500/20">
                        {keyError}
                      </div>
                    )}
                    {keySuccess && (
                      <div className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/40 p-1.5 rounded border border-emerald-500/20">
                        {keySuccess}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="submit"
                        className="flex-1 py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px] transition-all cursor-pointer"
                      >
                        Save & Apply Key
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleGenerateSessionWallet();
                          setShowKeyForm(false);
                        }}
                        className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-[10px] transition-all cursor-pointer"
                        title="Reset to default session key"
                      >
                        Reset Key
                      </button>
                    </div>
                  </form>
                )}
              </div>
"""

address_row_anchor = "{/* Address Row */}"
if address_row_anchor in content and "Wallet Key Management" not in content:
    content = content.replace(address_row_anchor, update_key_ui + "\n              " + address_row_anchor)

with open('src/components/WalletStatusWidget.tsx', 'w') as f:
    f.write(content)

print("WalletStatusWidget updated successfully")
