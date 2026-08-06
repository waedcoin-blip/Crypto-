import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# 1. Find the trades effect
start_pattern = r"  useEffect\(\(\) => \{\n    // Process all new trades for metrics and alerts"
end_pattern = r"  \}, \[trades, autoSniperEnabled, buyAmountSol, telegramBotToken, telegramChatId\]\);\n"

start_idx = content.find("  useEffect(() => {\n    // Process all new trades for metrics and alerts")
end_idx = content.find("  }, [trades, autoSniperEnabled, buyAmountSol, telegramBotToken, telegramChatId]);\n") + len("  }, [trades, autoSniperEnabled, buyAmountSol, telegramBotToken, telegramChatId]);\n")

if start_idx == -1 or end_idx == -1:
    print("Could not find the trades effect!")
    exit(1)

effect_body = content[start_idx:end_idx]

# Convert it to a ref-based function
# The inner part of the effect is:
#     if (newTrades.length > 0) {
#       newTrades.forEach(trade => {

inner_logic_start = effect_body.find("        // Update Token Metrics for BOTH buys and sells")
inner_logic_end = effect_body.find("              });\n            });\n          }\n        }\n      });\n    }\n  }, [trades")

inner_logic = effect_body[inner_logic_start:inner_logic_end]

# We need to replace autoSniperEnabled with latestState.current.autoSniperEnabled
# We need to replace executeAutoTrade with fns.current.executeAutoTrade
# and sendTelegramAlert with fns.current.sendTelegramAlert
inner_logic = inner_logic.replace("autoSniperEnabled", "latestState.current.autoSniperEnabled")
inner_logic = inner_logic.replace("executeAutoTrade(", "fns.current.executeAutoTrade(")
inner_logic = inner_logic.replace("sendTelegramAlert(", "fns.current.sendTelegramAlert(")

process_fn = f"""  const processIncomingTrade = (trade: Trade) => {{
    if (processedSigs.current.has(trade.signature)) return;
    processedSigs.current.add(trade.signature);
    
{inner_logic}              }});
            }});
          }}
        }}
  }};
"""

# Replace the effect with the new function
content = content[:start_idx] + process_fn + content[end_idx:]

# 2. Add processIncomingTrade call in conn.onLogs
# Where is the setTrades call?
set_trades_pattern = """              setTrades(prev => {
                // Deduplicate by signature first
                if (prev.some(t => t.signature === signature)) return prev;
                
                // Allow multiple trades of the same token to show a real feed 
                return [newTrade, ...prev].slice(0, 50);
              });"""
              
if set_trades_pattern not in content:
    print("Could not find setTrades pattern!")
    exit(1)

new_set_trades = """              setTrades(prev => {
                if (prev.some(t => t.signature === signature)) return prev;
                
                // Process enrichment immediately inside the pipeline
                processIncomingTrade(newTrade);
                
                return [newTrade, ...prev].slice(0, 50);
              });"""

content = content.replace(set_trades_pattern, new_set_trades)

with open('src/App.tsx', 'w') as f:
    f.write(content)
print("Success!")
