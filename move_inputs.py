import re

with open('src/components/pages/SimRealPage.tsx', 'r') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if '<label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">TP (Raydium)</label>' in line:
        # Find the start of this block
        for j in range(i, -1, -1):
            if '<div className="space-y-3">' in lines[j]:
                start_idx = j
                break
        
        # Find the end of this block
        for k in range(i, len(lines)):
            if '{privateKey ? (' in lines[k]:
                end_idx = k
                break
        break

if start_idx != -1 and end_idx != -1:
    block_lines = lines[start_idx:end_idx]
    
    # Remove it from the original place
    new_lines = lines[:start_idx] + lines[end_idx:]
    
    # Find the insertion point
    insert_idx = -1
    for i, line in enumerate(new_lines):
        if '{activeSimrealPositions.length} Active' in line:
            # Skip past the closing tags
            for j in range(i, len(new_lines)):
                if '<div className="space-y-3">' in new_lines[j]:
                    insert_idx = j
                    break
            break

    if insert_idx != -1:
        wrapped_block = [
            '            <div className="bg-[#0a0b14] border border-[#1f212e] rounded-xl p-4 mb-4">\n',
            '               <h3 className="text-[11px] font-mono text-[#94a3b8] uppercase tracking-wider mb-3 flex items-center gap-1.5">\n',
            '                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />\n',
            '                  Auto-Sell Limits (SimReal)\n',
            '               </h3>\n'
        ] + block_lines + [
            '            </div>\n'
        ]
        
        final_lines = new_lines[:insert_idx] + wrapped_block + new_lines[insert_idx:]
        
        with open('src/components/pages/SimRealPage.tsx', 'w') as f:
            f.writelines(final_lines)
        print("Success")
    else:
        print("Could not find insertion point")
else:
    print("Could not find block to extract")

