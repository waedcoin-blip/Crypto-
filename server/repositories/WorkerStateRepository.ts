// server/repositories/WorkerStateRepository.ts
import { JsonStore } from './JsonStore.js';

export interface WorkerState {
  worker: string;
  status: 'RUNNING' | 'STOPPED' | 'ERROR';
  lastHeartbeat: number;
  startedAt?: number;
  metadata?: Record<string, any>;
}

/**
 * WorkerStateRepository: Tracks the health of background workers.
 * Used by the health endpoint to determine overall system health.
 */
export class WorkerStateRepository {
  private static instance: WorkerStateRepository;
  private store: JsonStore<Record<string, WorkerState>>;
  private readonly STALE_THRESHOLD_MS = 60000; // 60 seconds without heartbeat = stale

  private constructor() {
    this.store = new JsonStore<Record<string, WorkerState>>('worker-state.json', {});
  }

  public static getInstance(): WorkerStateRepository {
    if (!WorkerStateRepository.instance) {
      WorkerStateRepository.instance = new WorkerStateRepository();
    }
    return WorkerStateRepository.instance;
  }

  /**
   * Record a heartbeat from a worker.
   */
  public async heartbeat(params: {
    worker: string;
    status: WorkerState['status'];
    lastHeartbeat?: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const all = this.store.read();
    const existing = all[params.worker];

    all[params.worker] = {
      worker: params.worker,
      status: params.status,
      lastHeartbeat: params.lastHeartbeat || Date.now(),
      startedAt: existing?.startedAt || (params.status === 'RUNNING' ? Date.now() : undefined),
      metadata: params.metadata,
    };

    this.store.write(all);
  }

  /**
   * Get the state of a specific worker.
   */
  public getWorkerState(worker: string): WorkerState | undefined {
    const all = this.store.read();
    return all[worker];
  }

  /**
   * Get all worker states.
   */
  public getAllWorkerStates(): Record<string, WorkerState> {
    return this.store.read();
  }

  /**
   * Check if a worker is healthy (running and not stale).
   */
  public isWorkerHealthy(worker: string): boolean {
    const state = this.getWorkerState(worker);
    if (!state) return false;
    if (state.status !== 'RUNNING') return false;
    if (Date.now() - state.lastHeartbeat > this.STALE_THRESHOLD_MS) return false;
    return true;
  }
}

export const workerStateRepository = WorkerStateRepository.getInstance();
