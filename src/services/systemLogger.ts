// src/services/systemLogger.ts
export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug';

export type LogCategory = 
  | 'PULSE_FEED'
  | 'PIPELINE'
  | 'STRATEGY'
  | 'BUY'
  | 'SELL'
  | 'POSITION'
  | 'SAFETY'
  | 'DECIMALS'
  | 'QUOTE'
  | 'RPC'
  | 'SYSTEM';

export interface SystemLogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  eventType?: string;
  source?: string;
  mint?: string;
  symbol?: string;
  wallet?: string;
  signature?: string;
  eventId?: string;
  status?: string;
  reason?: string;
  metadata?: Record<string, any>;
}

export type SystemLogListener = (log: SystemLogEntry) => void;

class SystemLogger {
  private static instance: SystemLogger;
  private logs: SystemLogEntry[] = [];
  private readonly maxLogs = 1000;
  private listeners: Set<SystemLogListener> = new Set();

  public static getInstance(): SystemLogger {
    if (!SystemLogger.instance) {
      SystemLogger.instance = new SystemLogger();
    }
    return SystemLogger.instance;
  }

  public subscribe(listener: SystemLogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public log(entry: Omit<SystemLogEntry, 'id' | 'timestamp'> & { timestamp?: number }): SystemLogEntry {
    const fullEntry: SystemLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: entry.timestamp || Date.now(),
      ...entry,
    };

    this.logs.unshift(fullEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.length = this.maxLogs;
    }

    // Broadcast to listeners
    for (const listener of this.listeners) {
      try {
        listener(fullEntry);
      } catch (err) {
        console.error('[SystemLogger] Listener error:', err);
      }
    }

    return fullEntry;
  }

  public info(category: LogCategory, message: string, meta?: Partial<SystemLogEntry>): SystemLogEntry {
    return this.log({ level: 'info', category, message, ...meta });
  }

  public warn(category: LogCategory, message: string, meta?: Partial<SystemLogEntry>): SystemLogEntry {
    return this.log({ level: 'warn', category, message, ...meta });
  }

  public error(category: LogCategory, message: string, meta?: Partial<SystemLogEntry>): SystemLogEntry {
    return this.log({ level: 'error', category, message, ...meta });
  }

  public success(category: LogCategory, message: string, meta?: Partial<SystemLogEntry>): SystemLogEntry {
    return this.log({ level: 'success', category, message, ...meta });
  }

  public debug(category: LogCategory, message: string, meta?: Partial<SystemLogEntry>): SystemLogEntry {
    return this.log({ level: 'debug', category, message, ...meta });
  }

  public getLogs(): SystemLogEntry[] {
    return [...this.logs];
  }

  public clear(): void {
    this.logs = [];
  }
}

export const systemLogger = SystemLogger.getInstance();
