with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

target = """        let outAmountRaw = 0;
        let tokenAmount = 0;
        if (!quote) {"""

replacement = """        let outAmountRaw = 0;
        let tokenAmount = 0;
        let finalDecimals = 6;
        if (!quote) {"""

if target in content:
    content = content.replace(target, replacement)

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)

print("Fixed finalDecimals declaration")
