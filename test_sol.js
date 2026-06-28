const { Connection, PublicKey } = require('@solana/web3.js');
async function run() {
  const conn = new Connection('https://api.mainnet-beta.solana.com');
  const info = await conn.getAccountInfo(new PublicKey("FE2vyoM5CbGcTXSHUsPj79eKAd8fvMzuy3jgr9pYBCLv"));
  console.log("Account Info:", info);
}
run();
