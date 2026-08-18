import re

with open('src/components/WalletStatusWidget.tsx', 'r') as f:
    content = f.read()

# Add import
import_line = "import { getKeypairFromPrivateKey } from '../utils/keypairUtils';"
if import_line not in content:
    content = "import { getKeypairFromPrivateKey } from '../utils/keypairUtils';\n" + content

old_try_block = """    try {
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
      const kp = Keypair.fromSecretKey(secretKeyUint8);"""

new_try_block = """    try {
      const kp = getKeypairFromPrivateKey(raw);"""

content = content.replace(old_try_block, new_try_block)

with open('src/components/WalletStatusWidget.tsx', 'w') as f:
    f.write(content)

print("Patched WalletStatusWidget.tsx successfully")
