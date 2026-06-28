import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
// Initialize Firestore with long polling for better stability in restricted environments
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (error: any) {
    if (error.code === 'auth/popup-blocked') {
      console.error('Sign-in popup was blocked by the browser. Please allow popups for this site.');
      throw new Error('SIGN_IN_POPUP_BLOCKED');
    } else if (error.code === 'auth/cancelled-popup-request') {
      console.warn('Sign-in process already in progress or cancelled.');
      // Silently return or handle as needed
    } else {
      console.error('Firebase Auth Error:', error);
      throw error;
    }
  }
};

async function testConnection() {
  try {
    // Attempting a real server fetch to confirm connection
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connection verified successfully.");
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('the client is offline') || error.message.includes('unavailable')) {
        console.error("Firestore connectivity issue: The backend is currently unreachable. The app will continue in offline mode.", error.message);
      } else {
        console.error("Firestore error:", error.message);
      }
    }
  }
}
testConnection();
