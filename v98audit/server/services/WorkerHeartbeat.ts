// server/services/WorkerHeartbeat.ts
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';

export function startWorkerHeartbeat(workerName: string = 'trading', intervalMs: number = 3000): () => void {
  const timer = setInterval(async () => {
    try {
      await workerStateRepository.heartbeat({
        worker: workerName,
        status: 'RUNNING',
        lastHeartbeat: Date.now(),
      });
    } catch (err) {
      console.warn(`[WorkerHeartbeat] Failed to pulse heartbeat for ${workerName}:`, err);
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
