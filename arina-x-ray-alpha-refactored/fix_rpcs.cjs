const fs = require('fs');

let mainFile = fs.readFileSync('src/main.tsx', 'utf8');
mainFile = mainFile.replace(/https:\/\/mainnet\.helius-rpc\.com\/\?api-key=[a-z0-9-]+/g, 'https://cool-green-leaf.solana-mainnet.quiknode.pro/2c673ac7dc301a21dc99dee9935316f0cd048a5a/');
fs.writeFileSync('src/main.tsx', mainFile);

let appFile = fs.readFileSync('src/App.tsx', 'utf8');
appFile = appFile.replace(/https:\/\/mainnet\.helius-rpc\.com\/\?api-key=[a-z0-9-]+/g, 'https://cool-green-leaf.solana-mainnet.quiknode.pro/2c673ac7dc301a21dc99dee9935316f0cd048a5a/');
appFile = appFile.replace(/wss:\/\/mainnet\.helius-rpc\.com\/\?api-key=[a-z0-9-]+/g, 'wss://cool-green-leaf.solana-mainnet.quiknode.pro/2c673ac7dc301a21dc99dee9935316f0cd048a5a/');
fs.writeFileSync('src/App.tsx', appFile);

let pnlFile = fs.readFileSync('src/components/pages/PnLPage.tsx', 'utf8');
pnlFile = pnlFile.replace(/https:\/\/mainnet\.helius-rpc\.com\/\?api-key=demo/g, 'https://cool-green-leaf.solana-mainnet.quiknode.pro/2c673ac7dc301a21dc99dee9935316f0cd048a5a/');
fs.writeFileSync('src/components/pages/PnLPage.tsx', pnlFile);
