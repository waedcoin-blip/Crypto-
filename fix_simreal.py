import re

with open('src/components/pages/SimRealPage.tsx', 'r') as f:
    content = f.read()

# Find the start of the block to delete
start_str = "        // Gate 0.0: Signal Freshness Gate - reject stale/re-hydrated signals (> 120s old)"
start_idx = content.find(start_str)

# Find the end of the block
end_str = "        markExecuted(signal.id, `tx-copy-${Date.now()}`);\n"
end_idx = content.find(end_str, start_idx) + len(end_str)

if start_idx != -1 and end_idx != -1:
    new_content = content[:start_idx] + content[end_idx:]
    with open('src/components/pages/SimRealPage.tsx', 'w') as f:
        f.write(new_content)
    print("Success")
else:
    print("Not found", start_idx, end_idx)
