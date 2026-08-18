import re

# 1. Update App.tsx
with open('src/App.tsx', 'r') as f:
    app_content = f.read()

old_app_mount = """  // Load session wallet on mount
  useEffect(() => {
    const savedKey = sessionStorage.getItem('matrix_session_key');
    if (savedKey) {
      try {
        const decoded = bs58.decode(savedKey);
        setSessionWallet(getKeypairFromPrivateKey(savedKey));
      } catch (e) {
        console.error('Failed to load session wallet');
        sessionStorage.removeItem('matrix_session_key');
      }
    }
  }, []);

  const generateSessionWallet = () => {
    const kp = useBalanceStore.getState().network === 'devnet' ? Keypair.fromSeed(new Uint8Array(32).fill(7)) : Keypair.generate();
    const encoded = bs58.encode(kp.secretKey);
    sessionStorage.setItem('matrix_session_key', encoded);
    setSessionWallet(kp);
    addNotification('New Session Wallet Generated. Deposit SOL to start auto-trading.');
  };"""

new_app_mount = """  // Load session wallet on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('matrix_user_custom_key') || sessionStorage.getItem('matrix_session_key');
    if (savedKey) {
      try {
        const kp = getKeypairFromPrivateKey(savedKey);
        setSessionWallet(kp);
        return;
      } catch (e) {
        console.error('Failed to load session wallet', e);
        sessionStorage.removeItem('matrix_session_key');
        localStorage.removeItem('matrix_user_custom_key');
      }
    }
    const kp = Keypair.generate();
    const encoded = bs58.encode(kp.secretKey);
    sessionStorage.setItem('matrix_session_key', encoded);
    setSessionWallet(kp);
  }, []);

  const generateSessionWallet = () => {
    const customKey = localStorage.getItem('matrix_user_custom_key') || sessionStorage.getItem('matrix_session_key');
    if (customKey) {
      try {
        const kp = getKeypairFromPrivateKey(customKey);
        setSessionWallet(kp);
        return;
      } catch (e) {
        // ignore
      }
    }
    const kp = Keypair.generate();
    const encoded = bs58.encode(kp.secretKey);
    sessionStorage.setItem('matrix_session_key', encoded);
    setSessionWallet(kp);
    addNotification('New Session Wallet Generated. Deposit SOL to start auto-trading.');
  };"""

if old_app_mount in app_content:
    app_content = app_content.replace(old_app_mount, new_app_mount)
    with open('src/App.tsx', 'w') as f:
        f.write(app_content)
    print("Patched App.tsx session wallet handling")
else:
    print("Could not find old_app_mount pattern in App.tsx")

# 2. Update WalletStatusWidget.tsx
with open('src/components/WalletStatusWidget.tsx', 'r') as f:
    widget_content = f.read()

old_widget_submit = """      const kp = getKeypairFromPrivateKey(raw);
      const encoded = bs58.encode(kp.secretKey);
      sessionStorage.setItem('matrix_session_key', encoded);
      localStorage.setItem('juipter_auto_privateKey', encoded);
      setSessionWallet(kp);"""

new_widget_submit = """      const kp = getKeypairFromPrivateKey(raw);
      const encoded = bs58.encode(kp.secretKey);
      sessionStorage.setItem('matrix_session_key', encoded);
      localStorage.setItem('matrix_user_custom_key', encoded);
      localStorage.setItem('juipter_auto_privateKey', encoded);
      setSessionWallet(kp);"""

widget_content = widget_content.replace(old_widget_submit, new_widget_submit)

old_gen = "const kp = network === 'devnet' ? Keypair.fromSeed(new Uint8Array(32).fill(7)) : Keypair.generate();"
new_gen = """const customKey = localStorage.getItem('matrix_user_custom_key');
    if (customKey) {
      try {
        const kp = getKeypairFromPrivateKey(customKey);
        setSessionWallet(kp);
        return;
      } catch (e) {}
    }
    const kp = Keypair.generate();"""

widget_content = widget_content.replace(old_gen, new_gen)

old_disc = "sessionStorage.removeItem('matrix_session_key');"
new_disc = "sessionStorage.removeItem('matrix_session_key');\n    localStorage.removeItem('matrix_user_custom_key');"
widget_content = widget_content.replace(old_disc, new_disc)

with open('src/components/WalletStatusWidget.tsx', 'w') as f:
    f.write(widget_content)

print("Patched WalletStatusWidget.tsx session wallet handling")
