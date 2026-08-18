import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

old_gen = "const kp = network === 'devnet' ? Keypair.fromSeed(new Uint8Array(32).fill(7)) : Keypair.generate();"
new_gen = "const kp = useBalanceStore.getState().network === 'devnet' ? Keypair.fromSeed(new Uint8Array(32).fill(7)) : Keypair.generate();"

content = content.replace(old_gen, new_gen)

with open('src/App.tsx', 'w') as f:
    f.write(content)
