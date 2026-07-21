import re

with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

old_code = """    // 2. Decide what needs to be sold
    const shouldSellMain = !!pos.amount && pos.amount > 0 && !reason.includes('SIMREAL SECURE PROFIT') && !reason.includes('SIMREAL STOP LOSS');
    const shouldSellSimReal = !!pos.simRealBought && (
      reason.includes('SIMREAL SECURE PROFIT') ||
      reason.includes('SIMREAL STOP LOSS') ||
      reason.includes('EMERGENCY') ||
      reason.includes('FORCE') ||
      reason.includes('MANUAL') ||
      simRealNetPnlPct > 0
    );"""

new_code = """    const isTransferToSimReal = reason.includes('TRANSFER TO SIMREAL');

    // 2. Decide what needs to be sold
    const shouldSellMain = !!pos.amount && pos.amount > 0 && !reason.includes('SIMREAL SECURE PROFIT') && !reason.includes('SIMREAL STOP LOSS');
    const shouldSellSimReal = !!pos.simRealBought && !isTransferToSimReal && (
      reason.includes('SIMREAL SECURE PROFIT') ||
      reason.includes('SIMREAL STOP LOSS') ||
      reason.includes('EMERGENCY') ||
      reason.includes('FORCE') ||
      reason.includes('MANUAL') ||
      simRealNetPnlPct > 0
    );"""

content = content.replace(old_code, new_code)

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)
