// server/trading/PriorityScheduler.ts
import { MarketEvent } from '../market/EventNormalizer.js';

export enum PriorityLevel {
  P0_EMERGENCY_SELL = 0,
  P1_STANDARD_SELL = 1,
  P2_MIGRATION_BUY = 2,
  P3_BONDING_CURVE_BUY = 3,
  P4_HIGH_MOMENTUM_BUY = 4,
  P5_NORMAL_BUY = 5,
  P6_ENRICHMENT = 6,
  P7_ANALYTICS_UI = 7,
}

export interface ScheduledTask<T = any> {
  id: string;
  priority: PriorityLevel;
  execute: () => Promise<T>;
  createdAt: number;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
}

export class PriorityScheduler {
  private static instance: PriorityScheduler;
  private queue: ScheduledTask[] = [];
  private activeWorkers = 0;
  private readonly maxConcurrentWorkers = 4;

  private constructor() {}

  public static getInstance(): PriorityScheduler {
    if (!PriorityScheduler.instance) {
      PriorityScheduler.instance = new PriorityScheduler();
    }
    return PriorityScheduler.instance;
  }

  /**
   * Schedules a task with a given priority level.
   * If priority is P0 or P1, it executes immediately to prevent blockage.
   */
  public async schedule<T>(priority: PriorityLevel, execute: () => Promise<T>): Promise<T> {
    const id = `task_${Math.random().toString(36).slice(2, 11)}_${Date.now()}`;

    // Bypass queue entirely for Sell Priorities (P0 & P1) to achieve lowest latency exits
    if (priority <= PriorityLevel.P1_STANDARD_SELL) {
      try {
        return await execute();
      } catch (err) {
        throw err;
      }
    }

    return new Promise<T>((resolve, reject) => {
      const task: ScheduledTask<T> = {
        id,
        priority,
        execute,
        createdAt: Date.now(),
        resolve,
        reject,
      };

      this.queue.push(task);
      this.sortQueue();
      this.processNext();
    });
  }

  private sortQueue(): void {
    // Sort primarily by priority (ascending, lower number = higher priority), then by age (createdAt)
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.createdAt - b.createdAt;
    });
  }

  private async processNext(): Promise<void> {
    if (this.activeWorkers >= this.maxConcurrentWorkers || this.queue.length === 0) {
      return;
    }

    this.activeWorkers++;
    const task = this.queue.shift()!;

    try {
      const result = await task.execute();
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    } finally {
      this.activeWorkers--;
      this.processNext();
    }
  }

  public getQueueDepth(): number {
    return this.queue.length;
  }

  public getMetrics(): any {
    return {
      queueDepth: this.queue.length,
      activeWorkers: this.activeWorkers,
      pendingTasksCount: this.queue.length,
    };
  }
}

export const priorityScheduler = PriorityScheduler.getInstance();
