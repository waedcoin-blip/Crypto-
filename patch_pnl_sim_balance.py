with open('src/components/pages/PnLPage.tsx', 'r') as f:
    content = f.read()

# 1. Update Sim Buy sync
old_sim_buy_sync = "syncSimBalanceToStore();\n        addLog(`✅ [SIM] Bought ${symbol}"
new_sim_buy_sync = "syncSimBalanceToStore((b) => setSimWalletBalance(b));\n        addLog(`✅ [SIM] Bought ${symbol}"
content = content.replace(old_sim_buy_sync, new_sim_buy_sync)

old_sim_buy_catch = "addLog(`[SIM] Failed: ${e.message}`, 'err');\n         syncSimBalanceToStore();"
new_sim_buy_catch = "addLog(`[SIM] Failed: ${e.message}`, 'err');\n         syncSimBalanceToStore((b) => setSimWalletBalance(b));"
content = content.replace(old_sim_buy_catch, new_sim_buy_catch)

# 2. Update Manual Sim Sell credit & sync
old_manual_sell_sync = """        const realWalletReturn = Math.max(0, netReceivedSOL - getDynamicOperationalFeeSol(pos.recoveryMode, pos.solSpent));
        const walletNetPnlPct = (realWalletReturn - pos.solSpent) / pos.solSpent;
        syncSimBalanceToStore();"""

new_manual_sell_sync = """        const realWalletReturn = Math.max(0, netReceivedSOL - getDynamicOperationalFeeSol(pos.recoveryMode, pos.solSpent));
        const walletNetPnlPct = (realWalletReturn - pos.solSpent) / pos.solSpent;
        const simExecManual = getSimExecutor();
        simExecManual.getSolBalance().then(curBal => {
          simExecManual.setVirtualSol(curBal + realWalletReturn);
          syncSimBalanceToStore((b) => setSimWalletBalance(b));
        });"""

content = content.replace(old_manual_sell_sync, new_manual_sell_sync)

# 3. Update Auto Sim Sell credit & sync
old_auto_sell_sync = """        if (!isRealModeActive) {
          syncSimBalanceToStore();
        } else {"""

new_auto_sell_sync = """        if (!isRealModeActive) {
          const simExecAuto = getSimExecutor();
          simExecAuto.getSolBalance().then(curBal => {
            simExecAuto.setVirtualSol(curBal + actualSolReceived);
            syncSimBalanceToStore((b) => setSimWalletBalance(b));
          });
        } else {"""

content = content.replace(old_auto_sell_sync, new_auto_sell_sync)

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(content)

print("Patched PnLPage.tsx sim balance logic")
