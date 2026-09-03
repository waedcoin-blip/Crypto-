// src/services/ExitPriorityQueue.ts
import { ExitTriggerSignal, ExitReason } from './ExitTriggerEngine';

export interface QueuedExitRequest {
  id: string;
  signal: ExitTriggerSignal;
  positionId: string;
  mint: string;
  amountRawToSell: number;
  priority: number;
  queuedAt: number;
  attemptCount: number;
}

export class ExitPriorityQueue {
  private static instance: ExitPriorityQueue;
  private queue: QueuedExitRequest[] = [];
  private activePositionLocks: Map<string, string> = new Map(); // positionId -> requestId

  public static getInstance(): ExitPriorityQueue {
    if (!ExitPriorityQueue.instance) {
      ExitPriorityQueue.instance = new ExitPriorityQueue();
    }
    return ExitPriorityQueue.instance;
  }

  public getPriorityForReason(reason: ExitReason): number {
    switch (reason) {
      case 'EMERGENCY_EXIT':
      case 'LIQUIDITY_FAILURE':
        return 1;
      case 'STOP_LOSS':
        return 2;
      case 'TRAILING_PROFIT':
        return 3;
      case 'TAKE_PROFIT':
      case 'PARTIAL_TAKE_PROFIT':
        return 4;
      case 'MAX_HOLD_TIME':
        return 5;
      case 'MANUAL_EXIT':
      default:
        return 6;
    }
  }

  /**
   * Enqueues an exit request. If an exit request for the same position already exists,
   * a higher priority signal will preempt and replace the existing item.
   */
  public enqueue(
    signal: ExitTriggerSignal,
    positionId: string,
    amountRawToSell: number
  ): QueuedExitRequest | null {
    const priority = signal.priority || this.getPriorityForReason(signal.reason);
    const existingIndex = this.queue.findIndex((item) => item.positionId === positionId);

    if (existingIndex !== -1) {
      const existing = this.queue[existingIndex];
      // Preemption check: Higher priority (lower numerical value) replaces existing item
      if (priority < existing.priority) {
        console.warn(`[ExitPriorityQueue] PREEMPTION: Replacing queued ${existing.signal.reason} (p=${existing.priority}) with higher priority ${signal.reason} (p=${priority}) for ${signal.mint}`);
        this.queue.splice(existingIndex, 1);
      } else {
        // Drop lower or equal priority duplicate request
        return null;
      }
    }

    const req: QueuedExitRequest = {
      id: `exit_req_${positionId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      signal,
      positionId,
      mint: signal.mint,
      amountRawToSell,
      priority,
      queuedAt: Date.now(),
      attemptCount: 0,
    };

    this.queue.push(req);
    // Sort queue by priority ascending (1 highest -> 6 lowest)
    this.queue.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);
    return req;
  }

  public dequeue(): QueuedExitRequest | undefined {
    return this.queue.shift();
  }

  public peek(): QueuedExitRequest | undefined {
    return this.queue[0];
  }

  public removeByPositionId(positionId: string): void {
    this.queue = this.queue.filter((item) => item.positionId !== positionId);
    this.activePositionLocks.delete(positionId);
  }

  public isPositionQueuedOrProcessing(positionId: string): boolean {
    return this.queue.some((item) => item.positionId === positionId) || this.activePositionLocks.has(positionId);
  }

  public setProcessingLock(positionId: string, requestId: string): void {
    this.activePositionLocks.set(positionId, requestId);
  }

  public releaseProcessingLock(positionId: string): void {
    this.activePositionLocks.delete(positionId);
  }

  public clear(): void {
    this.queue = [];
    this.activePositionLocks.clear();
  }

  public size(): number {
    return this.queue.length;
  }
}

export const exitPriorityQueue = ExitPriorityQueue.getInstance();
