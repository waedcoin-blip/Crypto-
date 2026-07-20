import re

with open('src/App.tsx', 'r') as f:
    code = f.read()

# Locate the setInterval inside the useEffect for tokenMetrics and add position updating logic
metric_interval_regex = re.compile(r'(const interval = setInterval\(\(\) => \{\s*setTokenMetrics\(prev => \{.+?return changed \? next : prev;\s*\}\);\s*\}, 10000\);)', re.DOTALL)

def replace_metric_interval(match):
    original = match.group(1)
    new_logic = """
    // Advanced Price Synchronization for Active Positions
    const positionSyncInterval = setInterval(async () => {
      const state = useAppStore.getState();
      const positions = state.activePositions;
      if (Object.keys(positions).length === 0) return;
      
      const mints = Object.keys(positions).join(',');
      try {
         const res = await fetch(`/api/dex/tokens/${mints}`);
         if (!res.ok) return;
         const data = await res.json();
         if (data && data.pairs) {
            state.setTokenMetrics(prev => {
               const next = { ...prev };
               data.pairs.forEach((p: any) => {
                  const addr = p.baseToken?.address;
                  if (addr && positions[addr]) {
                     next[addr] = {
                        ...next[addr],
                        address: addr,
                        priceUsd: Number(p.priceUsd || 0),
                        priceNative: Number(p.priceNative || 0),
                        lastUpdated: Date.now()
                     };
                  }
               });
               return next;
            });
         }
      } catch (e) {
         console.warn("[SYNC ERROR] Failed to sync active positions", e);
      }
    }, 3000);
    """
    return original + new_logic

code = metric_interval_regex.sub(replace_metric_interval, code)

# Add clearInterval for positionSyncInterval
cleanup_regex = re.compile(r'(return \(\) => clearInterval\(interval\);)')

def replace_cleanup(match):
    return "return () => {\n      clearInterval(interval);\n      clearInterval(positionSyncInterval);\n    };"

code = cleanup_regex.sub(replace_cleanup, code)

with open('src/App.tsx', 'w') as f:
    f.write(code)

