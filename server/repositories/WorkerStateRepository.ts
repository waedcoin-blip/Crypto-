// server/repositories/WorkerStateRepository.ts
import { readDataFile, updateDataFileAtomic } from '../db/jsonStore.js';

export interface WorkerState {
  worker: string;
  status: 'RUNNING' | 'STOPPED' | 'ERROR';
  lastHeartbeat: number;
  metadata?: Record<string, any>;
  version?: number;
}

const FILE_NAME = 'worker_state.json';

export class WorkerStateRepository {
  private static instance: WorkerStateRepository;

  private constructor() {}

  public static getInstance(): WorkerStateRepository {
    if (!WorkerStateRepository.instance) {
      WorkerStateRepository.instance = new WorkerStateRepository();
    }
    return WorkerStateRepository.instance;
  }

  private readAll(): WorkerState[] {
    return readDataFile<WorkerState[]>(FILE_NAME, []);
  }

  public async heartbeat(data: { worker: string; status: 'RUNNING' | 'STOPPED' | 'ERROR'; lastHeartbeat: number; metadata?: Record<string, any> }): Promise<void> {
    updateDataFileAtomic<WorkerState[]>(FILE_NAME, [], (current) => {
      const idx = current.findIndex(w => w.worker === data.worker);
      if (idx !== -1) {
        const existing = current[idx];
        current[idx] = {
          ...existing,
          ...data,
          metadata: { ...(existing.metadata || {}), ...(data.metadata || {}) },
          version: (existing.version || 1) + 1,
        };
      } else {
        current.push({
          ...data,
          version: 1,
        });
      }
      return current;
    });
  }

  public async updateMetadata(worker: string, metadata: Record<string, any>): Promise<void> {
    updateDataFileAtomic<WorkerState[]>(FILE_NAME, [], (current) => {
      const idx = current.findIndex(w => w.worker === worker);
      if (idx !== -1) {
        const existing = current[idx];
        current[idx] = {
          ...existing,
          metadata: { ...(existing.metadata || {}), ...metadata },
          version: (existing.version || 1) + 1,
        };
      }
      return current;
    });
  }

  public getWorkerState(worker: string = 'trading'): WorkerState | undefined {
    return this.readAll().find(w => w.worker === worker);
  }
}

export const workerStateRepository = WorkerStateRepository.getInstance();
