import re

with open('src/services/jupiterService.ts', 'r') as f:
    code = f.read()

swap_regex = re.compile(r'(export async function createJupiterSwapTransaction.+?)(const swapRes = await fetch.+?\{.+?method: \'POST\',.+?body: JSON\.stringify\(\{)(.+?)(\}\).+?)(if \(!swapRes\.ok\) throw new Error.+?)(return await swapRes\.json\(\);)', re.DOTALL)

def replace_swap(match):
    return match.group(1) + match.group(2) + match.group(3) + ",\n      dynamicComputeUnitLimit: true,\n      prioritizationFeeLamports: priorityTipLamports || 'auto'" + match.group(4) + match.group(5) + """
    const result = await swapRes.json();
    if (!result.swapTransaction) throw new Error('Transaction building failed: No valid route or swap transaction returned.');
    return result;
"""

new_code = swap_regex.sub(replace_swap, code)

if new_code != code:
    with open('src/services/jupiterService.ts', 'w') as f:
        f.write(new_code)
    print("Updated swap transaction")
else:
    print("Could not find swap logic")

