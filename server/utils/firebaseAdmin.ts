import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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

if (!getApps().length && projectId) {
  initializeApp({
    projectId
  });
}

export const adminAuth = getAuth();
export const FIREBASE_PROJECT_ID = projectId;
export const FIRESTORE_DATABASE_ID = firestoreDatabaseId;
