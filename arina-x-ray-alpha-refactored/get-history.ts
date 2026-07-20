import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {}, firebaseConfig.firestoreDatabaseId);

async function main() {
  console.log("Fetching settings from Firestore...");
  try {
    const snap = await getDocs(collection(db, "settings"));
    console.log(`Found ${snap.size} documents in 'settings' collection.`);
    snap.forEach(doc => {
      const data = doc.data();
      console.log(`Document ID: ${doc.id}`);
      console.log(`  simWalletBalance: ${data.simWalletBalance}`);
      console.log(`  positions keys: ${data.positions ? Object.keys(JSON.parse(data.positions)) : 'none'}`);
      if (data.tradeHistory) {
        try {
          const history = JSON.parse(data.tradeHistory);
          console.log(`  tradeHistory length: ${history.length}`);
          console.log(JSON.stringify(history, null, 2));
        } catch (err) {
          console.error("  Failed to parse tradeHistory:", err);
        }
      } else {
        console.log("  No tradeHistory found");
      }
    });
  } catch (error) {
    console.error("Error fetching Firestore document:", error);
  }
}

main().then(() => process.exit(0));
