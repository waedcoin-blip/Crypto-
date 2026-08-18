import { PaperTradeExecutor } from './PaperTradeExecutor';
import { useBalanceStore } from '../store/balanceStore';

let simExecutorInstance: PaperTradeExecutor | null = null;

export function getSimExecutor(initialBalance?: number, currentJup: string = 'https://api.jup.ag/swap/v1'): PaperTradeExecutor {
    if (!simExecutorInstance) {
        let startBal = initialBalance;
        if (!startBal || startBal === 1.0) {
            const saved = typeof localStorage !== 'undefined' 
                ? (localStorage.getItem('app_authoritative_paper_balance_v1') || localStorage.getItem('juipter_auto_simWalletBalance') || localStorage.getItem('app_simulationBalance_v4'))
                : null;
            if (saved) {
                const parsed = Number(saved);
                if (!isNaN(parsed) && parsed > 0) {
                    startBal = parsed;
                }
            }
        }
        simExecutorInstance = new PaperTradeExecutor({
            jupiterEndpoint: currentJup,
            jupiterApiKey: '',
            initialSolBalance: startBal || 10.0,
            latencyRange: [10, 50],
        });
    }
    return simExecutorInstance;
}

export function resetSimExecutor(initialBalance: number = 10.0): void {
    simExecutorInstance = new PaperTradeExecutor({
        jupiterEndpoint: 'https://api.jup.ag/swap/v1',
        jupiterApiKey: '',
        initialSolBalance: initialBalance,
        latencyRange: [10, 50],
    });
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('app_authoritative_paper_balance_v1', initialBalance.toString());
        localStorage.setItem('juipter_auto_simWalletBalance', initialBalance.toString());
        localStorage.setItem('app_simulationBalance_v4', initialBalance.toString());
    }
    syncSimBalanceToStore();
}

export function setSimExecutorBalance(bal: number): void {
    if (simExecutorInstance) {
        simExecutorInstance.setVirtualSol(bal);
        syncSimBalanceToStore();
    }
}

export function syncSimBalanceToStore(onBalanceUpdated?: (bal: number) => void) {
    if (simExecutorInstance) {
        simExecutorInstance.getSolBalance().then(bal => {
            useBalanceStore.getState().setBalance({ solBalance: bal, availableSolBalance: bal, reservedSol: 0 });
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('app_authoritative_paper_balance_v1', bal.toString());
                localStorage.setItem('juipter_auto_simWalletBalance', bal.toString());
                localStorage.setItem('app_simulationBalance_v4', bal.toString());
            }
            if (onBalanceUpdated) {
                onBalanceUpdated(bal);
            }
        });
    }
}
