import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

let projectId = '';
let firestoreDatabaseId = '';

try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    projectId = config.projectId;
    firestoreDatabaseId = config.firestoreDatabaseId;
  }
} catch (e) {
  console.error('Could not load firebase config', e);
}

let app: any = null;
try {
  if (!getApps().length && projectId) {
    app = initializeApp({ projectId });
  } else if (getApps().length) {
    app = getApps()[0];
  }
} catch (err) {
  console.warn('Could not initialize Firebase Admin App:', err);
}

let authInstance: ReturnType<typeof getAuth> | null = null;
try {
  if (app || getApps().length > 0) {
    authInstance = getAuth(app || getApps()[0]);
  }
} catch (err) {
  console.warn('Could not initialize Firebase Admin Auth:', err);
}

export function getAdminAuth() {
  if (!authInstance && (app || getApps().length > 0)) {
    try {
      authInstance = getAuth(app || getApps()[0]);
    } catch {}
  }
  return authInstance;
}

export const adminAuth = authInstance;

let dbInstance: Firestore | null = null;
try {
  if (app || getApps().length > 0) {
    const targetApp = app || getApps()[0];
    dbInstance = firestoreDatabaseId ? getFirestore(targetApp, firestoreDatabaseId) : getFirestore(targetApp);
  }
} catch (err) {
  console.warn('Could not initialize Firebase Admin Firestore instance directly:', err);
}

export const adminDb = dbInstance;
export const FIREBASE_PROJECT_ID = projectId;
export const FIRESTORE_DATABASE_ID = firestoreDatabaseId;

