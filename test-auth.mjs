import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFile } from 'fs/promises';

const config = JSON.parse(await readFile('./firebase-applet-config.json', 'utf-8'));

initializeApp({ projectId: config.projectId });

try {
  await getAuth().verifyIdToken('invalid-token');
} catch(e) {
  console.log("Error:", e.message);
}
