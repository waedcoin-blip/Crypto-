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

const app = !getApps().length && projectId
  ? initializeApp({
      projectId
    })
  : getApps()[0];

export const adminAuth = getAuth();

let dbInstance: Firestore | null = null;
try {
  if (app) {
    dbInstance = firestoreDatabaseId ? getFirestore(app, firestoreDatabaseId) : getFirestore(app);
  }
} catch (err) {
  console.warn('Could not initialize Firebase Admin Firestore instance directly:', err);
}

export const adminDb = dbInstance;
export const FIREBASE_PROJECT_ID = projectId;
export const FIRESTORE_DATABASE_ID = firestoreDatabaseId;

