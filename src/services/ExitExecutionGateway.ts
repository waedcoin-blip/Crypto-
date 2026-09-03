// src/services/ExitExecutionGateway.ts

export interface ExitLatencyMetrics {
  positionId: string;
  mint: string;
  reason: string;
  eventToTriggerMs: number;
  triggerToQuoteMs: number;
  quoteToBuildMs: number;
  buildToSubmitMs: number;
  submitToConfirmationMs: number;
  totalExitMs: number;
  attempts: number;
  timestamp: number;
}

export class ExitExecutionGateway {
  private static instance: ExitExecutionGateway;

  public static getInstance(): ExitExecutionGateway {
    if (!ExitExecutionGateway.instance) {
      ExitExecutionGateway.instance = new ExitExecutionGateway();
    }
    return ExitExecutionGateway.instance;
  }

  public async processQueue(): Promise<void> {
    // No-op client-side. Execution is handled server-side.
  }

  public async executeExitRequest(request: any): Promise<boolean> {
    // No-op client-side. Execution is handled server-side.
    return false;
  }

  public getLatencyMetrics(): ExitLatencyMetrics[] {
    return [];
  }
}

export const exitExecutionGateway = ExitExecutionGateway.getInstance();
