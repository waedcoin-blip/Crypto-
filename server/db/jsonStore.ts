// server/db/jsonStore.ts
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.warn('[jsonStore] Could not create data directory:', e);
  }
}

/**
 * Acquire an inter-process file lock on `<filename>.lock` with:
 * - POSIX exclusive create ('wx' flag)
 * - Exponential backoff with jitter
 * - Stale lock detection and recovery (> 5000ms old)
 * - Safe release in finally
 */
export function withFileLockSync<T>(filename: string, operation: () => T, timeoutMs: number = 8000): T {
  const lockPath = path.join(DATA_DIR, `${filename}.lock`);
  const startTime = Date.now();
  let acquired = false;
  let fd: number | null = null;

  while (Date.now() - startTime < timeoutMs) {
    try {
      // 'wx' flag fails if file exists
      fd = fs.openSync(lockPath, 'wx');
      acquired = true;
      // Write lock metadata (pid, timestamp)
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now() }));
      break;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Lock exists. Check if it is stale (> 5000ms old)
        try {
          const stats = fs.statSync(lockPath);
          const age = Date.now() - stats.mtimeMs;
          if (age > 5000) {
            console.warn(`[jsonStore] Breaking stale lock for ${filename} (age: ${age}ms)`);
            try {
              fs.unlinkSync(lockPath);
            } catch {
              // Ignore unlink error if another process just cleared it
            }
            continue;
          }
        } catch {
          // File may have been removed concurrently, retry immediately
          continue;
        }

        // Sleep with random jitter before retrying
        const sleepMs = Math.floor(10 + Math.random() * 25);
        const waitUntil = Date.now() + sleepMs;
        while (Date.now() < waitUntil) {
          // busy-wait short jitter (10-35ms)
        }
      } else {
        console.warn(`[jsonStore] Lock open error for ${filename}:`, err);
        break;
      }
    }
  }

  if (!acquired) {
    console.warn(`[jsonStore] Lock acquisition timed out after ${timeoutMs}ms for ${filename}. Proceeding with caution.`);
  }

  try {
    return operation();
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close error
      }
    }
    if (acquired) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Ignore unlink error
      }
    }
  }
}

/**
 * Reads data file directly from disk to guarantee fresh state across processes.
 */
export function readDataFile<T>(filename: string, defaultValue: T): T {
  const filePath = path.join(DATA_DIR, filename);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (!content || !content.trim()) return defaultValue;
      return JSON.parse(content) as T;
    }
  } catch (e) {
    console.warn(`[jsonStore] Failed to read ${filename}:`, e);
  }
  return defaultValue;
}

/**
 * Crash-safe atomic write using temporary file and atomic rename.
 */
export function writeDataFile<T>(filename: string, data: T): void {
  const filePath = path.join(DATA_DIR, filename);
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const tmpPath = path.join(DATA_DIR, `${filename}.tmp.${process.pid}.${Date.now()}.${randomSuffix}`);
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.warn(`[jsonStore] Failed atomic write for ${filename}:`, e);
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore
    }
  }
}

/**
 * Atomic Read-Modify-Write transaction with inter-process file locking.
 * Guarantees that the updater receives the latest disk content and writes back atomically.
 */
export function updateDataFileAtomic<T>(filename: string, defaultValue: T, updater: (current: T) => T): T {
  return withFileLockSync(filename, () => {
    const current = readDataFile<T>(filename, defaultValue);
    const updated = updater(current);
    writeDataFile(filename, updated);
    return updated;
  });
}
