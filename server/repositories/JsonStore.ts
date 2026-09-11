// server/repositories/JsonStore.ts
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * JsonStore: Atomic JSON file storage with stale-lock recovery.
 * Used by all repositories for persistent state.
 */
export class JsonStore<T> {
  private filePath: string;
  private cache: T | null = null;

  constructor(private filename: string, private defaultValue: T) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    this.filePath = path.join(DATA_DIR, filename);
  }

  public read(): T {
    if (this.cache !== null) return this.cache;

    try {
      if (!fs.existsSync(this.filePath)) {
        this.cache = this.defaultValue;
        return this.cache;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as T;
      return this.cache!;
    } catch {
      this.cache = this.defaultValue;
      return this.cache;
    }
  }

  public write(data: T): void {
    this.cache = data;
    const lockPath = this.filePath + '.lock';

    // Acquire lock with stale-lock recovery
    const maxAttempts = 10;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const fd = fs.openSync(lockPath, 'wx');
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now() }));
        fs.closeSync(fd);
        break;
      } catch (err: any) {
        if (err.code === 'EEXIST') {
          try {
            const stats = fs.statSync(lockPath);
            const age = Date.now() - stats.mtimeMs;
            if (age > 5000) {
              console.warn(`[JsonStore] Breaking stale lock for ${this.filename} (age: ${age}ms)`);
              try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
              continue;
            }
          } catch { continue; }
          // Wait and retry
          const waitMs = 50 * (i + 1);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
          continue;
        }
        throw err;
      }
    }

    try {
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
    } finally {
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    }
  }

  public invalidateCache(): void {
    this.cache = null;
  }
}
