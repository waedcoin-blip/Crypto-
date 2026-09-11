// src/services/StartupReconciliation.ts
export class StartupReconciliation {
  private static instance: StartupReconciliation;

  public static getInstance(): StartupReconciliation {
    if (!StartupReconciliation.instance) {
      StartupReconciliation.instance = new StartupReconciliation();
    }
    return StartupReconciliation.instance;
  }

  public static async runReconciliation(): Promise<void> {
    try {
      await fetch('/api/trading/positions');
    } catch {
      // Reconcile silently
    }
  }

  public async reconcile(): Promise<void> {
    return StartupReconciliation.runReconciliation();
  }
}

export const startupReconciliation = StartupReconciliation.getInstance();
