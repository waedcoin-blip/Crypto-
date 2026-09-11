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
import { tradingMonitorWorker } from '../workers/TradingMonitorWorker.js';

export type SupervisorState =
  | 'STOPPED'
  | 'STARTING'
  | 'WALLET_READY'
  | 'EXECUTION_READY'
  | 'STREAMING_READY'
  | 'TRADING'
  | 'STOPPING'
  | 'RECOVERY'
  | 'START_FAILED';

export type ComponentHealth = 'READY' | 'DEGRADED' | 'FAILED' | 'PENDING';

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
  state: SupervisorState;
  network: string;
  wallet: string;
  mode: string;
  isLiveTrading: boolean;
  startedAt?: number;
  stoppedAt?: number;
  lastError?: string;
  healthMap: ComponentHealthMap;
}

export class TradingSupervisor {
  private static instance: TradingSupervisor;

  public state: SupervisorState = 'STOPPED';
  public network: string = 'paper';
  public wallet: string = 'default';
  private startedAt?: number;
  private stoppedAt?: number;
  private lastError?: string;
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

  // ==========================================
  // STATE MACHINE
  // ==========================================

  private transitionTo(newState: SupervisorState): void {
    console.log(`[TradingSupervisor] STATE TRANSITION: ${this.state} → ${newState}`);
    this.state = newState;
  }

  private enterRecovery(reason: string): void {
    console.error(`[TradingSupervisor] ENTERING RECOVERY MODE: ${reason}`);
    this.lastError = reason;
    this.transitionTo('RECOVERY');
  }

  // ==========================================
  // START TRADING
  // ==========================================

  public async startTrading(params: {
    network?: string;
    wallet?: string;
    isLiveTrading?: boolean;
  } = {}): Promise<SupervisorStatus> {
    if (this.state === 'TRADING' || this.state === 'STARTING') {
      return this.getStatus();
    }

    this.transitionLock = true;
    this.transitionTo('STARTING');
    this.startedAt = Date.now();
    this.lastError = undefined;

    try {
      // 1. Resolve network
      const rawNet = (params.network || 'paper').toLowerCase().trim();
      if (!['paper', 'devnet', 'mainnet', 'mainnet-beta'].includes(rawNet)) {
        throw new Error(`INVALID_NETWORK_EXPLICIT_REQUIRED: ${rawNet} is not a valid network`);
      }
      this.network = rawNet === 'mainnet-beta' ? 'mainnet' : rawNet;
      this.wallet = params.wallet || 'default';

      // 2. Initialize wallet
      const account = walletManager.getAccountByNetworkAndWallet(this.network, this.wallet);
      if (!account) throw new Error('WALLET_INIT_FAILED');
      this.healthMap.wallet = 'READY';
      this.transitionTo('WALLET_READY');

      // 3. Verify execution readiness
      const readiness = await executionGateway.verifyReadiness(this.network, account.publicKey.toBase58());
      if (!readiness.ready) {
        throw new Error(`EXECUTION_NOT_READY: ${readiness.reason}`);
      }
      this.healthMap.executionGateway = 'READY';
      this.transitionTo('EXECUTION_READY');

      // 4. Start streaming transport
      await streamingTransportManager.start();
      this.healthMap.marketFeed = 'READY';
      this.transitionTo('STREAMING_READY');

      // 5. Load position state from repository
      positionManager.refreshFromRepository();

      // 6. Start entry engine
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

      // 7. Transition to TRADING
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
      console.error(`[TradingSupervisor] START_FAILED: ${errMsg}`, err);
      this.transitionTo('START_FAILED');
      return this.getStatus();
    } finally {
      this.transitionLock = false;
    }
  }

  // ==========================================
  // STOP TRADING
  // ==========================================

  public async stopTrading(): Promise<SupervisorStatus> {
    if (this.state === 'STOPPED') return this.getStatus();
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

      return this.getStatus();
    } catch (err: any) {
      this.lastError = err?.message || String(err);
      this.enterRecovery(`STOP_ERROR: ${this.lastError}`);
      return this.getStatus();
    } finally {
      this.transitionLock = false;
    }
  }

  // ==========================================
  // FORCE RECOVERY (Admin Override)
  // ==========================================

  public forceRecovery(reason: string): SupervisorStatus {
    if (this.state === 'TRADING' || this.state === 'RECOVERY') {
      this.enterRecovery(reason);
    } else {
      this.state = 'RECOVERY';
      console.warn(`[TradingSupervisor] FORCED RECOVERY from ${this.state} due to: ${reason}`);
    }
    return this.getStatus();
  }

  // ==========================================
  // STATUS
  // ==========================================

  public getStatus(): SupervisorStatus {
    return {
      state: this.state,
      network: this.network,
      wallet: this.wallet,
      mode: this.network === 'paper' ? 'PAPER' : 'LIVE',
      isLiveTrading: this.network !== 'paper',
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      lastError: this.lastError,
      healthMap: { ...this.healthMap },
    };
  }
}

export const tradingSupervisor = TradingSupervisor.getInstance();
