// server/trading/PriorityScheduler.ts
import { logger } from '../utils/logger.js';

export type PriorityLevel = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

interface QueuedTask<T = any> {
  id: string;
  priority: PriorityLevel;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  createdAt: number;
}

const PRIORITY_ORDER: Record<PriorityLevel, number> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

export class PriorityScheduler {
  private static instance: PriorityScheduler;
  private queue: QueuedTask[] = [];
  private activeWorkers: number = 0;
  private readonly maxConcurrent: number;
  private isProcessing: boolean = false;

  // Emergency sell rate limiting
  private emergencySellCount: number = 0;
  private lastEmergencySellReset: number = Date.now();
  private readonly maxEmergencySellsPerSecond: number = 10;

  // Telemetry
  private totalScheduled: number = 0;
  private totalCompleted: number = 0;
  private totalFailed: number = 0;

  private constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  public static getInstance(): PriorityScheduler {
    if (!PriorityScheduler.instance) {
      PriorityScheduler.instance = new PriorityScheduler();
    }
    return PriorityScheduler.instance;
  }

  // ==========================================
  // TASK SCHEDULING
  // ==========================================

  public schedule<T>(
    fn: () => Promise<T>,
    priority: PriorityLevel = 'NORMAL',
    id?: string
  ): Promise<T> {
    // Emergency sell bypass: execute immediately if under rate limit
    if (priority === 'CRITICAL') {
      const now = Date.now();
      if (now - this.lastEmergencySellReset > 1000) {
        this.emergencySellCount = 0;
        this.lastEmergencySellReset = now;
      }

      if (this.emergencySellCount < this.maxEmergencySellsPerSecond) {
        this.emergencySellCount++;
        this.totalScheduled++;
        return fn().finally(() => { this.totalCompleted++; });
      }
      // Rate limit hit: queue it instead of bypassing
    }

    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask<T> = {
        id: id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        priority,
        fn,
        resolve,
        reject,
        createdAt: Date.now(),
      };
      this.queue.push(task);
      this.totalScheduled++;
      this.processQueue();
    });
  }

  // ==========================================
  // QUEUE PROCESSING
  // ==========================================

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0 && this.activeWorkers < this.maxConcurrent) {
        // Sort by priority (CRITICAL first)
        this.queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

        const task = this.queue.shift();
        if (!task) break;

        this.activeWorkers++;
        try {
          const result = await task.fn();
          task.resolve(result);
          this.totalCompleted++;
        } catch (err) {
          task.reject(err);
          this.totalFailed++;
        } finally {
          this.activeWorkers--;
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  // ==========================================
  // TELEMETRY
  // ==========================================

  public getMetrics() {
    return {
      queueDepth: this.queue.length,
      activeWorkers: this.activeWorkers,
      maxConcurrent: this.maxConcurrent,
      totalScheduled: this.totalScheduled,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
      emergencySellCount: this.emergencySellCount,
    };
  }

  // Inspect actual tasks waiting in the queue
  public getQueueDetails(): Array<{ id: string; priority: PriorityLevel; createdAt: number; ageMs: number }> {
    const now = Date.now();
    return this.queue.map(task => ({
      id: task.id,
      priority: task.priority,
      createdAt: task.createdAt,
      ageMs: now - task.createdAt,
    }));
  }
}

export const priorityScheduler = PriorityScheduler.getInstance();
