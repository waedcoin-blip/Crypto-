with open('src/services/SimExecutorSingleton.ts', 'a') as f:
    f.write("\nimport { useBalanceStore } from '../store/balanceStore';\n")
    f.write("export function syncSimBalanceToStore() {\n")
    f.write("    if (simExecutorInstance) {\n")
    f.write("        simExecutorInstance.getSolBalance().then(bal => {\n")
    f.write("            useBalanceStore.getState().setBalance({ solBalance: bal, availableSolBalance: bal, reservedSol: 0 });\n")
    f.write("        });\n")
    f.write("    }\n")
    f.write("}\n")
