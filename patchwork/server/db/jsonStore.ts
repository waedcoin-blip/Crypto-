// server/db/jsonStore.ts
import fs from 'fs';
import path from 'path';

// For production, point DATA_DIR at a persistent volume. The store uses atomic
// replace semantics so a crash cannot leave a half-written JSON document.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

function safePath(filename: string): string {
  const resolved = path.resolve(DATA_DIR, filename);
  if (!resolved.startsWith(DATA_DIR + path.sep)) throw new Error('INVALID_DATA_FILENAME');
  return resolved;
}

export function readDataFile<T>(filename: string, defaultValue: T): T {
  const filePath = safePath(filename);
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (e) {
    console.warn(`[jsonStore] Failed to read ${filename}:`, e);
    return defaultValue;
  }
}

export function writeDataFile<T>(filename: string, data: T): void {
  const filePath = safePath(filename);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    console.error(`[jsonStore] Failed to write ${filename}:`, e);
    throw new Error(`PERSISTENCE_WRITE_FAILED: ${filename}`);
  }
}

export { DATA_DIR };
