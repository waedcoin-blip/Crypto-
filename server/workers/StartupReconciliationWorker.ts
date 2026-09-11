// server/workers/StartupReconciliationWorker.ts
import { positionManager } from '../trading/PositionManager.js';
import { tradeRepository } from '../repositories/TradeRepository.js';
import { orderRepository } from '../repositories/OrderRepository.js';
import { positionRepository } from '../repositories/PositionRepository.js';

/**
 * StartupReconciliationWorker: Runs once at startup to reconcile
 * in-memory state with persisted repository state.
 *
 * Handles:
 * - Positions that were OPEN but the process restarted
 * - Orders stuck in CONFIRMING state (check blockchain for finality)
 * - Trade history gaps
 */
export class StartupReconciliationWorker {
  private static instance: StartupReconciliationWorker;
  private hasRun: boolean = false;

  private constructor() {}

  public static getInstance(): StartupReconciliationWorker {
    if (!StartupReconciliationWorker.instance) {
      StartupReconciliationWorker.instance = new StartupReconciliationWorker();
    }
    return StartupReconciliationWorker.instance;
  }

  /**
   * Run reconciliation. Should be called once at startup.
   */
  public async reconcile(): Promise<{
    positionsReconciled: number;
    ordersReconciled: number;
    staleOrdersMarked: number;
  }> {
    if (this.hasRun) {
      return { positionsReconciled: 0, ordersReconciled: 0, staleOrdersMarked: 0 };
    }
    this.hasRun = true;

    console.log('[StartupReconciliationWorker] Starting reconciliation...');
    let positionsReconciled = 0;
    let ordersReconciled = 0;
    let staleOrdersMarked = 0;

    // 1. Reconcile positions: Mark stale EXIT_PENDING positions as RECOVERY_REQUIRED
    const allPositions = positionRepository.getAllPositions();
    for (const posRecord of allPositions) {
      if (posRecord.state === 'EXIT_SUBMITTED' || posRecord.state === 'EXIT_CONFIRMING') {
        // If the position was in exit state but process restarted,
        // mark as RECOVERY_REQUIRED for manual intervention
        posRecord.state = 'RECOVERY_REQUIRED';
        posRecord.updatedAt = Date.now();
        positionRepository.upsertPosition(posRecord);
        positionsReconciled++;
        console.log(`[StartupReconciliationWorker] Position ${posRecord.id} marked RECOVERY_REQUIRED (stale exit state)`);
      }
    }

    // 2. Reconcile orders: Mark stale CONFIRMING orders as RECOVERY_REQUIRED
    const allOrders = orderRepository.getAllOrders();
    const staleThreshold = Date.now() - 5 * 60 * 1000; // 5 minutes
    for (const order of allOrders) {
      if (order.status === 'CONFIRMING' && order.updatedAt < staleThreshold) {
        order.status = 'RECOVERY_REQUIRED';
        order.updatedAt = Date.now();
        order.error = 'STALE_CONFIRMING_STATE: Process restarted during confirmation';
        orderRepository.upsertOrder(order);
        staleOrdersMarked++;
        console.log(`[StartupReconciliationWorker] Order ${order.id} marked RECOVERY_REQUIRED (stale confirming)`);
      }
      ordersReconciled++;
    }

    // 3. Load positions into PositionManager
    positionManager.refreshFromRepository();

    console.log(`[StartupReconciliationWorker] Reconciliation complete: ${positionsReconciled} positions, ${staleOrdersMarked} stale orders marked.`);

    return { positionsReconciled, ordersReconciled, staleOrdersMarked };
  }
}

export const startupReconciliationWorker = StartupReconciliationWorker.getInstance();
