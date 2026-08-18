import re

with open('src/components/WalletStatusWidget.tsx', 'r') as f:
    content = f.read()

old_gen = "const kp = Keypair.generate();"
new_gen = "const kp = network === 'devnet' ? Keypair.fromSeed(new Uint8Array(32).fill(7)) : Keypair.generate();"

content = content.replace(old_gen, new_gen)

with open('src/components/WalletStatusWidget.tsx', 'w') as f:
    f.write(content)

with open('src/App.tsx', 'r') as f:
    app_content = f.read()

app_content = app_content.replace(old_gen, new_gen)

with open('src/App.tsx', 'w') as f:
    f.write(app_content)
