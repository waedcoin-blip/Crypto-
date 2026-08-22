// scripts/devnet/verifyDevnetToken.ts
import { Connection, PublicKey } from '@solana/web3.js';

const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_SWAP_PROGRAM_ID = new PublicKey('pAMMTTktLtvsb8bNWV1n3Qp2C79r79iA2p8bB6A4dD7');
const DEVNET_RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';

async function main() {
  const mintStr = process.argv[2];
  if (!mintStr) {
    console.error('Usage: npx tsx scripts/devnet/verifyDevnetToken.ts <MINT_ADDRESS>');
    process.exit(1);
  }

  console.log(`🔍 Verifying Devnet Token on ${DEVNET_RPC}`);
  console.log(`🪙 Mint: ${mintStr}`);

  try {
    const mintPk = new PublicKey(mintStr);
    const connection = new Connection(DEVNET_RPC, 'confirmed');

    const [bondingCurvePk] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintPk.toBuffer()],
      PUMP_FUN_PROGRAM_ID
    );

    const [poolPk] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), mintPk.toBuffer()],
      PUMP_SWAP_PROGRAM_ID
    );

    console.log(`📌 Derived Pump Bonding Curve PDA: ${bondingCurvePk.toBase58()}`);
    console.log(`📌 Derived PumpSwap Pool PDA: ${poolPk.toBase58()}`);

    const [mintAcc, curveAcc, poolAcc] = await Promise.all([
      connection.getAccountInfo(mintPk, 'confirmed'),
      connection.getAccountInfo(bondingCurvePk, 'confirmed'),
      connection.getAccountInfo(poolPk, 'confirmed'),
    ]);

    console.log('\n--- On-Chain Status ---');
    console.log(`Mint Account Exists: ${mintAcc ? '✅ YES (' + mintAcc.lamports + ' lamports, ' + mintAcc.data.length + ' bytes)' : '❌ NO'}`);
    console.log(`Bonding Curve Account Exists: ${curveAcc ? '✅ YES (' + curveAcc.data.length + ' bytes, owner: ' + curveAcc.owner.toBase58() + ')' : '❌ NO'}`);
    console.log(`PumpSwap AMM Pool Account Exists: ${poolAcc ? '✅ YES (' + poolAcc.data.length + ' bytes, owner: ' + poolAcc.owner.toBase58() + ')' : '❌ NO'}`);

    console.log(`\n🔗 Solscan Explorer: https://solscan.io/token/${mintStr}?cluster=devnet`);
  } catch (err: any) {
    console.error('❌ Verification error:', err.message || err);
  }
}

main();
