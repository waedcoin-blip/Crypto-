import re

with open('src/App.tsx', 'r') as f:
    code = f.read()

# Fix executeAutoSell
sell_block = re.search(r'(const executeAutoSell = async .+?)(const executePartialSell = async)', code, re.DOTALL)
if sell_block:
    sell_code = sell_block.group(1)
    
    # replace percent with 100 in sellRawAmount
    sell_code = sell_code.replace('const sellRawAmount = Math.floor(Number(balanceRaw) * (percent / 100.0));', 'const sellRawAmount = Math.floor(Number(balanceRaw));')
    
    # replace "partial sell execution" with "sell execution"
    sell_code = sell_code.replace('throw new Error("No route for partial sell execution");', 'throw new Error("No route for sell execution");')
    
    # replace back into code
    code = code[:sell_block.start()] + sell_code + code[sell_block.end()-len(sell_block.group(2)):]

with open('src/App.tsx', 'w') as f:
    f.write(code)

