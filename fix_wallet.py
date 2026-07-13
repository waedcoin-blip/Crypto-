import re

with open('src/App.tsx', 'r') as f:
    code = f.read()

# Add duplicate wallet check
wallet_regex = re.compile(r'(const addWallet = async \(e: React\.FormEvent\) => \{\s*e\.preventDefault\(\);\s*setError\(\'\'\);\s*if \(!address\) return;\s*if \(!safePublicKey\(address\)\) \{\s*setError\(\'Invalid Solana address\'\);\s*return;\s*\})(.+?)(try \{)', re.DOTALL)

def replace_wallet(match):
    prefix = match.group(1)
    new_logic = """
    if (monitoredWallets.some(w => w.address === address.trim())) {
      setError('Wallet is already monitored');
      return;
    }
    """
    return prefix + new_logic + match.group(3)

code = wallet_regex.sub(replace_wallet, code)

with open('src/App.tsx', 'w') as f:
    f.write(code)

