import re

with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

# Pull variables up before the if (!quote) block
old_if_block = """        let outAmountRaw = 0;
        let tokenAmount = 0;
        if (!quote) {"""

new_if_block = """        let outAmountRaw = 0;
        let tokenAmount = 0;
        let finalDecimals = 6;
        if (!quote) {"""

content = content.replace(old_if_block, new_if_block)

# Replace local fallbackDecimals with finalDecimals
old_fallback = """           const fallbackDecimals = await resolveDecimals(mint, rpcUrl);
           outAmountRaw = Math.floor(tokenAmount * Math.pow(10, fallbackDecimals));"""

new_fallback = """           finalDecimals = await resolveDecimals(mint, rpcUrl);
           outAmountRaw = Math.floor(tokenAmount * Math.pow(10, finalDecimals));"""

content = content.replace(old_fallback, new_fallback)

# Replace local estimatedDecimals with finalDecimals
old_estimated = """           if (outAmountRaw > 0) {
             let estimatedDecimals = await resolveDecimals(mint, rpcUrl);
             const impliedDecimals = Math.round(Math.log10(outAmountRaw / exactMathFallback));
             if (Math.abs(estimatedDecimals - impliedDecimals) >= 2) {
               estimatedDecimals = Math.max(0, impliedDecimals);
             }
             tokenAmount = outAmountRaw / Math.pow(10, estimatedDecimals);
             parsedPrice = solAmount / tokenAmount;
           } else {"""

new_estimated = """           if (outAmountRaw > 0) {
             finalDecimals = await resolveDecimals(mint, rpcUrl);
             const impliedDecimals = Math.round(Math.log10(outAmountRaw / exactMathFallback));
             if (Math.abs(finalDecimals - impliedDecimals) >= 2) {
               finalDecimals = Math.max(0, impliedDecimals);
             }
             tokenAmount = outAmountRaw / Math.pow(10, finalDecimals);
             parsedPrice = solAmount / tokenAmount;
           } else {"""

content = content.replace(old_estimated, new_estimated)

# Replace the usage in decimals definition
old_decimals_usage = """              decimals: existing?.decimals ?? (estimatedDecimals ?? fallbackDecimals ?? 6)"""
new_decimals_usage = """              decimals: existing?.decimals ?? finalDecimals"""

content = content.replace(old_decimals_usage, new_decimals_usage)

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)
