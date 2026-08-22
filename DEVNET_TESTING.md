# Devnet Native Pump.fun & PumpSwap Testing Guide

This guide describes how to generate, test, and swap real Devnet-native Pump tokens using the built-in token source and generator.

---

## 🚀 Key Features

1. **Devnet Native Token Source**:
   - Maintains an authoritative registry of active Devnet test tokens in `/data/devnet-tokens.json`.
   - When switching to `devnet` network mode, the scanner automatically ingests verified Devnet tokens.
   - Accurately tracks virtual/real SOL & token reserves, market cap, price, and graduation status.

2. **Real Test Token Generator**:
   - Generate test tokens via UI or CLI.
   - Derives authentic on-chain Pump.fun bonding curve PDAs (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) and Associated Bonding Curve ATAs.
   - Supports active bonding curves (`complete: false`) and graduated PumpSwap AMM pools (`complete: true`).
   - Supports 1-click airdrops directly to your test wallet.

3. **Dual AMM Route Resolution**:
   - Active bonding curves route directly through authentic Pump.fun instructions.
   - Graduated tokens route through the canonical PumpSwap AMM (`pAMMTTktLtvsb8bNWV1n3Qp2C79r79iA2p8bB6A4dD7`) or Raydium Devnet AMM.

---

## 🛠️ CLI Quick Commands

### 1. Generate Devnet Test Tokens
```bash
npx tsx scripts/devnet/createDevnetTestTokens.ts
```

### 2. List All Devnet Test Tokens
```bash
npx tsx scripts/devnet/listDevnetTokens.ts
```

### 3. Verify an On-Chain Devnet Token
```bash
npx tsx scripts/devnet/verifyDevnetToken.ts <MINT_ADDRESS>
```

---

## 📡 REST API Endpoints

- `GET /api/devnet/tokens`: List all Devnet tokens
- `GET /api/devnet/tokens/:mint`: Get specific token details & curve state
- `POST /api/devnet/create-token`: Generate a new Devnet test token
- `POST /api/devnet/airdrop`: Request Devnet SOL airdrop
- `POST /api/devnet/verify`: Probe on-chain existence on Devnet RPC
