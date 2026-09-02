export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export type SystemEventType =
  | 'WALLET_ADDED'
  | 'WALLET_REMOVED'
  | 'WALLET_SUBSCRIPTION_ACTIVE'
  | 'WALLET_SYNCED'
  | 'TRANSACTION_DETECTED'
  | 'TRANSACTION_PARSED'
  | 'TRANSACTION_REJECTED'
  | 'TRANSACTION_DUPLICATE'
  | 'TRANSACTION_PERSISTED'
  | 'RPC_FAILOVER'
  | 'WS_DISCONNECTED'
  | 'LASERSTREAM_DEGRADED'
  | 'TRADE_EXECUTED'
  | 'TRADE_FAILED';

export interface StructuredLog {
  timestamp: number;
  eventType: SystemEventType;
  level: LogLevel;
  source: string;
  message: string;
  wallet?: string;
  transactionSignature?: string;
  tokenMint?: string;
  slot?: number;
  metadata?: Record<string, unknown>;
}

type LogListener = (log: StructuredLog) => void;

class LoggerService {
  private listeners: LogListener[] = [];
  private logs: StructuredLog[] = [];
  private readonly maxLogs = 500;

  public subscribe(listener: LogListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public emit(eventType: SystemEventType, message: string, options: Partial<Omit<StructuredLog, 'timestamp' | 'eventType' | 'message'>> = {}): StructuredLog {
    const entry: StructuredLog = {
      timestamp: Date.now(),
      eventType,
      level: options.level || 'info',
      source: options.source || 'system',
      message,
      wallet: options.wallet,
      transactionSignature: options.transactionSignature,
      tokenMint: options.tokenMint,
      slot: options.slot,
      metadata: options.metadata,
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    if (entry.level === 'error') {
      console.error(`[${entry.source}] [${entry.eventType}] ${message}`, entry.metadata || '');
    } else if (entry.level === 'warn') {
      console.warn(`[${entry.source}] [${entry.eventType}] ${message}`, entry.metadata || '');
    } else {
      console.log(`[${entry.source}] [${entry.eventType}] ${message}`);
    }

    this.listeners.forEach(listener => {
      try {
        listener(entry);
      } catch (err) {
        console.error('Error in log listener:', err);
      }
    });

    return entry;
  }

  public getRecentLogs(): StructuredLog[] {
    return [...this.logs];
  }

  public clear(): void {
    this.logs = [];
  }
}

export const loggerService = new LoggerService();
