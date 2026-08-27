// src/services/StartupReconciliation.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig } from '../config/network';
import { useActiveWalletStore } from '../store/activeWalletStore';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { walletBalanceService } from './WalletBalanceService';
import { orderManager } from './OrderManager';
import { tokenRegistry } from './TokenRegistry';
import { useAppStore } from '../store/appStore';

export class StartupReconciliation {
  public static async runReconciliation(): Promise<void> {
    const network = useTradingEnvironmentStore.getState().network || 'devnet';
    const activeWallet = useActiveWalletStore.getState().activeWallet;
    if (!activeWallet || !activeWallet.address) {
      console.log('[StartupReconciliation] No active wallet connected. Skipping startup reconciliation.');
      return;
    }

    console.log(`[StartupReconciliation] Running startup reconciliation for wallet ${activeWallet.address} on ${network}...`);

    const rpcUrl = getNetworkConfig(network).rpcUrl;
    const connection = new Connection(rpcUrl, 'confirmed');

    // 1. Refresh on-chain SOL and Token balances
    await walletBalanceService.refresh(activeWallet.address);

    // 2. Load persisted active positions from app store
    const positions = useAppStore.getState().activePositions;
    const updatedPositions = { ...positions };
    let hasChanges = false;

    // 3. Reconcile each position against on-chain token accounts
    for (const [mint, pos] of Object.entries(positions)) {
      if (!mint || mint.toLowerCase().startsWith('sim')) continue;

      try {
        // Query on-chain raw balance for this mint
        const rawBalance = await walletBalanceService.getTokenBalance(mint, activeWallet.address);

        if (rawBalance <= 1000) {
          // Token balance is empty or dust on-chain
          if (pos.amount && pos.amount > 0) {
            console.log(`[StartupReconciliation] Position ${mint} has zero on-chain balance. Marking CLOSED.`);
            updatedPositions[mint] = { ...pos, amount: 0, state: 'CLOSED' };
            hasChanges = true;
          }
        } else {
          // Convert raw atomic units to human readable token count using actual decimals
          const decimals = pos.decimals ?? tokenRegistry.getToken(mint)?.decimals ?? 6;
          const humanAmount = rawBalance / Math.pow(10, decimals);
          if (Math.abs((pos.amount || 0) - humanAmount) > 0.01 || pos.state === 'RECOVERY_REQUIRED') {
            console.log(`[StartupReconciliation] Reconciled position ${mint}: humanAmount=${humanAmount}, rawBalance=${rawBalance}, decimals=${decimals}, state=OPEN.`);
            updatedPositions[mint] = { ...pos, amount: humanAmount, decimals, tokenQuantityRaw: rawBalance.toString(), state: 'OPEN' };
            hasChanges = true;
          }
        }
      } catch (err) {
        console.warn(`[StartupReconciliation] Failed on-chain query for ${mint}:`, err);
        updatedPositions[mint] = { ...pos, recoveryMode: true, state: 'RECOVERY_REQUIRED' };
        hasChanges = true;
      }
    }

    // 4. Check pending orders in OrderManager
    const pendingOrders = orderManager.getAllOrders().filter(o =>
      ['SUBMITTED', 'CONFIRMING', 'TRANSACTION_BUILDING', 'SIGNING'].includes(o.state)
    );

    for (const order of pendingOrders) {
      if (order.signature) {
        try {
          const status = await connection.getSignatureStatus(order.signature);
          if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
            if (!status.value.err) {
              orderManager.transitionState(order.id, 'CONFIRMED');
            } else {
              orderManager.transitionState(order.id, 'FAILED', { error: JSON.stringify(status.value.err) });
            }
          } else {
            orderManager.transitionState(order.id, 'RECOVERY_REQUIRED');
          }
        } catch {
          orderManager.transitionState(order.id, 'RECOVERY_REQUIRED');
        }
      } else {
        orderManager.transitionState(order.id, 'CANCELLED', { error: 'Interrupted prior to submission' });
      }
    }

    if (hasChanges) {
      useAppStore.getState().updateActivePositions(() => updatedPositions);
    }

    console.log('[StartupReconciliation] Startup reconciliation complete.');
  }
}
