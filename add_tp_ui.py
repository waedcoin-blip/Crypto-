import re

with open('src/components/pages/SimRealPage.tsx', 'r') as f:
    content = f.read()

old_ui = """                              <span className="text-rose-400 text-[9px] whitespace-nowrap bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                                SL: {activeSL}%
                              </span>"""

new_ui = """                              <span className="text-emerald-400 text-[9px] whitespace-nowrap bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                TP: {activeTP}%
                              </span>
                              <span className="text-rose-400 text-[9px] whitespace-nowrap bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                                SL: {activeSL}%
                              </span>"""

content = content.replace(old_ui, new_ui)

with open('src/components/pages/SimRealPage.tsx', 'w') as f:
    f.write(content)
