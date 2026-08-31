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

export function readDataFile<T>(filename: string, defaultValue: T): T {
  const filePath = path.join(DATA_DIR, filename);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content) as T;
    }
  } catch (e) {
    console.warn(`[jsonStore] Failed to read ${filename}:`, e);
  }
  return defaultValue;
}

export function writeDataFile<T>(filename: string, data: T): void {
  const filePath = path.join(DATA_DIR, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn(`[jsonStore] Failed to write ${filename}:`, e);
  }
}
