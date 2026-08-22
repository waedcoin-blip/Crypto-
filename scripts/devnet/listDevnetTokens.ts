// scripts/devnet/listDevnetTokens.ts
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'devnet-tokens.json');

function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.log('No devnet-tokens.json file found. Run createDevnetTestTokens.ts first.');
    return;
  }

  const tokens = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  console.log(`\n📋 Registered Devnet Test Tokens (${tokens.length} total):\n`);

  console.table(
    tokens.map((t: any) => ({
      Symbol: t.symbol,
      Name: t.name,
      Mint: t.mint,
      Type: t.complete ? 'PumpSwap (Graduated)' : 'Pump.fun (Curve)',
      'Price ($)': t.priceUsd ? `$${t.priceUsd.toFixed(8)}` : 'N/A',
      'Liquidity ($)': t.liquidityUsd ? `$${t.liquidityUsd.toLocaleString()}` : 'N/A',
      'Bonding Curve PDA': t.bondingCurve?.slice(0, 16) + '...',
    }))
  );
}

main();
