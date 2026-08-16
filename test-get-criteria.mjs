import { auth } from 'firebase-admin';
import { readFile } from 'fs/promises';
import { initializeApp, applicationDefault } from 'firebase-admin/app';

const config = JSON.parse(await readFile('./firebase-applet-config.json', 'utf-8'));
initializeApp({
  credential: applicationDefault(),
  projectId: config.projectId,
});

async function run() {
  // First we need a custom token or ID token. 
  // Admin SDK cannot directly mint ID tokens for fetch, so we can't test it this way easily without the client.
}
run();
