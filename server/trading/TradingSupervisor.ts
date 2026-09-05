// server/trading/TradingSupervisor.ts
import { walletManager } from '../wallet/WalletManager.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { streamingTransportManager } from '../market/StreamingTransportManager.js';
import { laserStreamPipeline } from '../market/LaserStreamPipeline.js';
import { candidateRegistry } from '../market/CandidateRegistry.js';
import { hardenedCriteriaEngine } from '../trading/HardenedCriteriaEngine.js';
import { hardenedApprovalStore } from '../trading/HardenedApprovalStore.js';
import { rebuyGuard } from '../trading/RebuyGuard.js';
import { positionRepository } from '../repositories/PositionRepository.js';
import { positionManager } from '../trading/PositionManager.js';
import { positionValuationEngine } from '../trading/PositionValuationEngine.js';
import { unifiedExitEngine } from '../trading/UnifiedExitEngine.js';
import { entryEngine } from '../trading/EntryEngine.js';
import { paperWalletLedger } from '../wallet/PaperWalletLedger.js';
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';
import { reconcileDatabaseWithMainnet } from '../workers/StartupReconciliationWorker.js';
import { tradingMonitorWorker } from '../workers/TradingMonitorWorker.js';

export type TradingLifecycleState =
  | 'STOPPED'
  | 'STARTING'
  | 'WALLET_READY'
  | 'PIPELINE_READY'
  | 'EXECUTOR_READY'
  | 'TRADING'
  | 'STOPPING'
  | 'START_FAILED'
  | 'RECOVERY';

export type ComponentHealth = 'READY' | 'DEGRADED' | 'FAILED';

export interface ComponentHealthMap {
  wallet: ComponentHealth;
  marketFeed: ComponentHealth;
  candidateRegistry: ComponentHealth;
  criteriaEngine: ComponentHealth;
  approvalStore: ComponentHealth;
  rebuyGuard: ComponentHealth;
  positionRepository: ComponentHealth;
  positionManager: ComponentHealth;
  valuationEngine: ComponentHealth;
  exitEngine: ComponentHealth;
  executionGateway: ComponentHealth;
  reconciliation: ComponentHealth;
  entryPipeline: ComponentHealth;
  paperLedger: ComponentHealth;
}

export interface SupervisorStatus {
  sessionId: string | null;
  state: TradingLifecycleState;
  network: string;
  wallet: string;
  executor: string;
  health: ComponentHealthMap;
  lastError: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  timestamp: number;
}

export class TradingSupervisor {
  private static instance: TradingSupervisor;

  private state: TradingLifecycleState = 'STOPPED';
  private sessionId: string | null = null;
  private network: string = 'paper';
  private wallet: string = 'default';
  private executorType: string = 'PaperTradeExecutor';
  private lastError: string | null = null;
  private startedAt: number | null = null;
  private stoppedAt: number | null = null;
  private transitionLock: boolean = false;

  private healthMap: ComponentHealthMap = {
    wallet: 'FAILED',
    marketFeed: 'FAILED',
    candidateRegistry: 'READY',
    criteriaEngine: 'READY',
    approvalStore: 'READY',
    rebuyGuard: 'READY',
    positionRepository: 'READY',
    positionManager: 'READY',
    valuationEngine: 'READY',
    exitEngine: 'READY',
    executionGateway: 'FAILED',
    reconciliation: 'READY',
    entryPipeline: 'READY',
    paperLedger: 'READY',
  };

  private constructor() {}

  public static getInstance(): TradingSupervisor {
    if (!TradingSupervisor.instance) {
      TradingSupervisor.instance = new TradingSupervisor();
    }
    return TradingSupervisor.instance;
  }

  public getStatus(): SupervisorStatus {
    return {
      sessionId: this.sessionId,
      state: this.state,
      network: this.network,
      wallet: this.wallet,
      executor: this.executorType,
      health: { ...this.healthMap },
      lastError: this.lastError,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      timestamp: Date.now(),
    };
  }

  private validateStateTransition(fromState: TradingLifecycleState, toState: TradingLifecycleState): boolean {
    const validTransitions: Record<TradingLifecycleState, TradingLifecycleState[]> = {
      STOPPED: ['STARTING'],
      STARTING: ['WALLET_READY', 'START_FAILED'],
      WALLET_READY: ['PIPELINE_READY', 'START_FAILED'],
      PIPELINE_READY: ['EXECUTOR_READY', 'START_FAILED'],
      EXECUTOR_READY: ['TRADING', 'START_FAILED'],
      TRADING: ['STOPPING', 'RECOVERY'],
      RECOVERY: ['TRADING', 'STOPPING', 'START_FAILED'],
      STOPPING: ['STOPPED'],
      START_FAILED: ['STARTING', 'STOPPED'],
    };

    const allowed = validTransitions[fromState] || [];
    if (!allowed.includes(toState)) {
      console.error(`[LIFECYCLE INVALID_STATE_TRANSITION] Cannot transition from ${fromState} to ${toState}`);
      return false;
    }
    return true;
  }

  private transitionTo(newState: TradingLifecycleState, reason?: string) {
    const prevState = this.state;
    if (prevState === newState) return;

    if (!this.validateStateTransition(prevState, newState)) {
      throw new Error(`INVALID_STATE_TRANSITION: Cannot transition from ${prevState} to ${newState}`);
    }

    this.state = newState;
    console.log(`[LIFECYCLE] sessionId=${this.sessionId} | network=${this.network} | wallet=${this.wallet} | ${prevState} -> ${newState}${reason ? ` (${reason})` : ''} | ts=${Date.now()}`);
  }

  public async startTrading(params: {
    network?: string;
    wallet?: string;
    buyAmountSol?: number;
    tpPct?: number;
    slPct?: number;
    maxPositions?: number;
  } = {}): Promise<SupervisorStatus> {
    // 1. Concurrency Mutex & Idempotency Check
    if (this.transitionLock) {
      console.warn(`[TradingSupervisor] START requested while transition lock held. Returning current status.`);
      return this.getStatus();
    }

    if (['STARTING', 'WALLET_READY', 'PIPELINE_READY', 'EXECUTOR_READY', 'TRADING'].includes(this.state)) {
      console.log(`[TradingSupervisor] Already active in state '${this.state}'. Idempotent start return.`);
      return this.getStatus();
    }

    this.transitionLock = true;
    this.sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.startedAt = Date.now();
    this.lastError = null;

    try {
      this.transitionTo('STARTING');

      // 1. Explicit Network Validation (FAIL CLOSED)
      const rawNet = (params.network || 'paper').toLowerCase().trim();
      if (!['paper', 'devnet', 'mainnet', 'mainnet-beta'].includes(rawNet)) {
        throw new Error(`INVALID_NETWORK_EXPLICIT_REQUIRED: '${params.network}' is not valid. Must be 'paper', 'devnet', or 'mainnet'.`);
      }
      this.network = rawNet === 'mainnet-beta' ? 'mainnet' : rawNet;
      this.wallet = params.wallet || 'default';

      // 2. Wallet Validation & Initialization
      const account = walletManager.getAccountByNetworkAndWallet(this.network, this.wallet);
      if (!account) {
        this.healthMap.wallet = 'FAILED';
        throw new Error(`WALLET_INITIALIZATION_FAILED: Could not resolve wallet account for network '${this.network}' and wallet '${this.wallet}'.`);
      }
      this.healthMap.wallet = 'READY';
      this.transitionTo('WALLET_READY');

      // 3. Candidate & Criteria Ingestion Architecture
      this.healthMap.candidateRegistry = 'READY';
      this.healthMap.criteriaEngine = 'READY';
      this.healthMap.approvalStore = 'READY';
      this.healthMap.rebuyGuard = 'READY';

      // 4. Market & Event Infrastructure Initialization
      try {
        laserStreamPipeline.start();
        await streamingTransportManager.start();
        this.healthMap.marketFeed = 'READY';
      } catch (feedErr: any) {
        console.warn(`[TradingSupervisor] Streaming transport standby:`, feedErr?.message || feedErr);
        this.healthMap.marketFeed = 'DEGRADED';
      }

      // 5. Position Store & Valuation Engine Initialization
      positionManager.refreshFromRepository();
      this.healthMap.positionRepository = 'READY';
      this.healthMap.positionManager = 'READY';
      this.healthMap.valuationEngine = 'READY';
      this.healthMap.exitEngine = 'READY';

      // 6. Reconciliation
      await reconcileDatabaseWithMainnet();
      this.healthMap.reconciliation = 'READY';

      this.transitionTo('PIPELINE_READY');

      // 7. Executor Verification
      const readiness = await executionGateway.verifyReadiness(this.network, account.publicKey);
      if (!readiness.ready) {
        this.healthMap.executionGateway = 'FAILED';
        throw new Error(`EXECUTOR_INITIALIZATION_FAILED: Executor for network '${this.network}' is not ready: ${readiness.reason}`);
      }
      this.executorType = executionGateway.getExecutor(this.network).constructor.name;
      this.healthMap.executionGateway = 'READY';
      if (this.network === 'paper') {
        this.healthMap.paperLedger = 'READY';
      }

      this.transitionTo('EXECUTOR_READY');

      // 8. Entry Engine & Workers Activation
      entryEngine.setConfig({
        autoSniperEnabled: true,
        isLiveTrading: this.network !== 'paper',
        network: this.network,
        wallet: this.wallet,
      });
      entryEngine.start();
      unifiedExitEngine.start();
      await tradingMonitorWorker.start();
      this.healthMap.entryPipeline = 'READY';

      // 9. Transition to TRADING
      this.transitionTo('TRADING');

      await workerStateRepository.heartbeat({
        worker: 'trading',
        status: 'RUNNING',
        lastHeartbeat: Date.now(),
      });

      return this.getStatus();
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      this.lastError = errMsg;
      console.error(`[TradingSupervisor FATAL] Startup failed in session ${this.sessionId}: ${errMsg}`);

      try {
        this.transitionTo('START_FAILED', errMsg);
      } catch {
        this.state = 'START_FAILED';
      }

      await workerStateRepository.heartbeat({
        worker: 'trading',
        status: 'ERROR',
        lastHeartbeat: Date.now(),
      });

      return this.getStatus();
    } finally {
      this.transitionLock = false;
    }
  }

  public async stopTrading(): Promise<SupervisorStatus> {
    if (this.transitionLock) {
      console.warn(`[TradingSupervisor] STOP requested while transition lock held.`);
    }

    if (this.state === 'STOPPED') {
      return this.getStatus();
    }

    if (this.state === 'START_FAILED') {
      this.state = 'STOPPED';
      return this.getStatus();
    }

    this.transitionLock = true;
    this.stoppedAt = Date.now();

    try {
      this.transitionTo('STOPPING');

      // Disable new entries
      entryEngine.stop();
      this.healthMap.entryPipeline = 'DEGRADED';

      // Note: UnifiedExitEngine & PositionManager remain ACTIVE for open positions!
      tradingMonitorWorker.stop();

      this.transitionTo('STOPPED');

      await workerStateRepository.heartbeat({
        worker: 'trading',
        status: 'STOPPED',
        lastHeartbeat: Date.now(),
      });

      console.log(`[TradingSupervisor] STOPPED. New entries disabled; active open positions remain managed for exit.`);
      return this.getStatus();
    } catch (err: any) {
      console.error(`[TradingSupervisor] Error during stop transition:`, err);
      this.state = 'STOPPED';
      return this.getStatus();
    } finally {
      this.transitionLock = false;
    }
  }

  public enterRecovery(reason: string) {
    if (this.state === 'TRADING') {
      try {
        this.transitionTo('RECOVERY', reason);
      } catch {
        this.state = 'RECOVERY';
      }
    }
  }
}

export const tradingSupervisor = TradingSupervisor.getInstance();

