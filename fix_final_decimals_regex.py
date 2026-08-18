import re

with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

pattern = r"(let\s+outAmountRaw\s*=\s*0;\s*let\s+tokenAmount\s*=\s*0;)"
replacement = r"\1\n        let finalDecimals = 6;"

new_content = re.sub(pattern, replacement, content)

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(new_content)

print("Replaced with regex successfully")
