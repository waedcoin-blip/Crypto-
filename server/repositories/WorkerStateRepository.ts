// server/repositories/WorkerStateRepository.ts
import { readDataFile, writeDataFile } from '../db/jsonStore.js';

export interface WorkerState {
  worker: string;
  status: 'RUNNING' | 'STOPPED' | 'ERROR';
  lastHeartbeat: number;
  metadata?: Record<string, any>;
}

const FILE_NAME = 'worker_state.json';

export class WorkerStateRepository {
  private static instance: WorkerStateRepository;
  private states: Map<string, WorkerState> = new Map();

  private constructor() {
    this.load();
  }

  public static getInstance(): WorkerStateRepository {
    if (!WorkerStateRepository.instance) {
      WorkerStateRepository.instance = new WorkerStateRepository();
    }
    return WorkerStateRepository.instance;
  }

  private load(): void {
    const list = readDataFile<WorkerState[]>(FILE_NAME, []);
    for (const item of list) {
      if (item && item.worker) {
        this.states.set(item.worker, item);
      }
    }
  }

  private save(): void {
    writeDataFile(FILE_NAME, Array.from(this.states.values()));
  }

  public async heartbeat(data: { worker: string; status: 'RUNNING' | 'STOPPED' | 'ERROR'; lastHeartbeat: number; metadata?: Record<string, any> }): Promise<void> {
    this.states.set(data.worker, data);
    this.save();
  }

  public getWorkerState(worker: string = 'trading'): WorkerState | undefined {
    return this.states.get(worker);
  }
}

export const workerStateRepository = WorkerStateRepository.getInstance();
