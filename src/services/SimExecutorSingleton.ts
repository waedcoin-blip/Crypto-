import { PaperTradeExecutor } from './PaperTradeExecutor';

let simExecutorInstance: PaperTradeExecutor | null = null;

export function getSimExecutor(initialBalance: number = 1.0, currentJup: string = 'https://api.jup.ag/swap/v1'): PaperTradeExecutor {
    if (!simExecutorInstance) {
        simExecutorInstance = new PaperTradeExecutor({
            jupiterEndpoint: currentJup,
            jupiterApiKey: '',
            initialSolBalance: initialBalance,
            latencyRange: [10, 50],
        });
    }
    return simExecutorInstance;
}

export function resetSimExecutor(initialBalance: number = 1.0): void {
    if (simExecutorInstance) {
        // We can just recreate it to reset it completely
        simExecutorInstance = new PaperTradeExecutor({
            jupiterEndpoint: 'https://api.jup.ag/swap/v1',
            jupiterApiKey: '',
            initialSolBalance: initialBalance,
            latencyRange: [10, 50],
        });
    }
}

import { useBalanceStore } from '../store/balanceStore';
export function syncSimBalanceToStore() {
    if (simExecutorInstance) {
        simExecutorInstance.getSolBalance().then(bal => {
            useBalanceStore.getState().setBalance({ solBalance: bal, availableSolBalance: bal, reservedSol: 0 });
        });
    }
}
