import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

function main() {
  const kp = Keypair.generate();
  const privateKey = bs58.encode(kp.secretKey);
  const publicKey = kp.publicKey.toBase58();

  console.log('\n======================================================');
  console.log('   Devnet Settlement Keypair Generated Successfully');
  console.log('======================================================\n');
  console.log('Public Key (Settlement Address):');
  console.log(`  ${publicKey}\n`);
  console.log('Server-Only Private Key (Base58):');
  console.log(`  ${privateKey}\n`);
  console.log('------------------------------------------------------');
  console.log('Next Steps:');
  console.log('1. Add this private key to your server environment (.env):');
  console.log(`   DEVNET_SETTLEMENT_PRIVATE_KEY=${privateKey}\n`);
  console.log('2. Fund the settlement address with Devnet SOL:');
  console.log(`   solana airdrop 2 ${publicKey} --url devnet\n`);
  console.log('3. Restart your dev server to load the settlement wallet.\n');
}

main();
