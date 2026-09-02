// server/services/WorkerHeartbeat.ts
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';

export function startWorkerHeartbeat(workerName: string = 'trading', intervalMs: number = 3000): () => void {
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  const loop = async () => {
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
  };
  
  timer = setInterval(() => {
    loop().catch(console.error);
  }, intervalMs);

  return () => {
    if (timer) clearInterval(timer);
  };
}
