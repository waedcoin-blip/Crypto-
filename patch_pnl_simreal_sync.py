with open('src/components/pages/PnLPage.tsx', 'r') as f:
    pnl = f.read()

# 1. Update activeMintsList in PnLPage.tsx
old_filter = "return p && typeof p === 'object' && p.symbol && typeof p.amount === 'number' && p.amount > 0;"
new_filter = "return p && typeof p === 'object' && p.symbol && ((typeof p.amount === 'number' && p.amount > 0) || !!p.simRealBought);"

pnl = pnl.replace(old_filter, new_filter)

# 2. Update interval duration from 4000 to 2000
old_interval = "    }, 4000); // 4s sync for positions"
new_interval = "    }, 2000); // 2s sync for positions"

pnl = pnl.replace(old_interval, new_interval)

with open('src/components/pages/PnLPage.tsx', 'w') as f:
    f.write(pnl)

print("PnLPage patched")

with open('src/components/pages/SimRealPage.tsx', 'r') as f:
    simreal = f.read()

# 3. Update monitorPositions interval in SimRealPage.tsx from 3000 to 2000
old_sim_interval = "    const interval = setInterval(monitorPositions, 3000);"
new_sim_interval = "    const interval = setInterval(monitorPositions, 2000);"

simreal = simreal.replace(old_sim_interval, new_sim_interval)

with open('src/components/pages/SimRealPage.tsx', 'w') as f:
    f.write(simreal)

print("SimRealPage patched")

