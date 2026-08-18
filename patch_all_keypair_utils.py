import re
import os

files_to_patch = [
    'src/App.tsx',
    'src/components/pages/PnLPage.tsx',
    'src/services/RealTradeExecutor.ts',
    'src/services/BatchExitEngine.ts',
    'src/services/JupiterUltraJitoWallet.ts',
    'src/services/HybridExecutionEngine.ts'
]

for file_path in files_to_patch:
    if not os.path.exists(file_path):
        continue
    with open(file_path, 'r') as f:
        content = f.read()

    # Determine relative import path
    depth = file_path.count('/') - 1
    rel_prefix = '../' * depth if depth > 0 else './'
    import_stmt = f"import {{ getKeypairFromPrivateKey }} from '{rel_prefix}utils/keypairUtils';"

    if import_stmt not in content and 'getKeypairFromPrivateKey' not in content:
        content = import_stmt + "\n" + content

    # Replace Keypair.fromSecretKey(bs58.decode(VAR)) pattern
    pattern = r"Keypair\.fromSecretKey\(\s*bs58\.decode\(([^)]+)\)\s*\)"
    content = re.sub(pattern, r"getKeypairFromPrivateKey(\1)", content)

    # Also in App.tsx: setSessionWallet(Keypair.fromSecretKey(decoded)); -> setSessionWallet(getKeypairFromPrivateKey(savedKey));
    content = content.replace("setSessionWallet(Keypair.fromSecretKey(decoded));", "setSessionWallet(getKeypairFromPrivateKey(savedKey));")

    with open(file_path, 'w') as f:
        f.write(content)

    print(f"Patched {file_path}")

