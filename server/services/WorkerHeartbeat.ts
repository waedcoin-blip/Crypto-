// server/services/WorkerHeartbeat.ts
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';

export function startWorkerHeartbeat(workerName: string = 'trading', intervalMs: number = 3000): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await workerStateRepository.heartbeat({
        worker: workerName,
        status: 'RUNNING',
        lastHeartbeat: Date.now(),
      });
    } catch (err) {
      console.warn(`[WorkerHeartbeat] Failed to pulse heartbeat for ${workerName}:`, err);
    } finally {
      running = false;
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
