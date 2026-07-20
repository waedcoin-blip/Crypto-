# Phase 2 Deployment Guide
## Security + Independent Trading Engine Implementation

**Status**: Ready to deploy  
**Time Estimate**: 4-6 hours  
**Risk Level**: Medium (requires testing with small amounts)

---

## Pre-Deployment Checklist

- [ ] You've reviewed QUICK_REFERENCE.md
- [ ] You've reviewed REFACTOR_AUDIT_2025.md
- [ ] You've reviewed SIMREALPAGE_INTEGRATION.md
- [ ] You have `crypto-js` package installed (`npm install crypto-js`)
- [ ] You have a test wallet with <0.5 SOL (for testing)
- [ ] You have access to block explorer for verification

---

## Step 1: Install Dependencies

The encryption system requires `crypto-js`:

```bash
npm install crypto-js
npm install --save-dev @types/crypto-js  # TypeScript types
```

---

## Step 2: Add Encryption Library

✅ **Already created**: `src/lib/keyEncryption.ts`

This file provides:
- `encryptPrivateKey(key, password)` → encrypted bundle
- `decryptPrivateKey(bundle, password)` → plaintext key
- `isValidBase58PrivateKey(key)` → validation
- Secure PBKDF2 key derivation
- AES-256-CBC encryption

**No action needed** — file is ready to import.

---

## Step 3: Add Private Key Vault Component

✅ **Already created**: `src/components/PrivateKeyVault.tsx`

This is a React component that:
- Shows locked/unlocked state
- Prompts for password
- Encrypts/decrypts keys on demand
- Stores encrypted bundles in localStorage
- Never shows plaintext key on screen

**Usage:**
```tsx
<PrivateKeyVault
  storageKey="simreal_privateKey"
  label="Private Key"
  onKeyReady={(unlockedKey) => setPrivateKey(unlockedKey)}
/>
```

**No action needed** — component is ready to import.

---

## Step 4: Replace SimRealPage Component

### Option A: Direct Replacement (Recommended)

```bash
# Backup old version (optional)
mv src/components/pages/SimRealPage.tsx src/components/pages/SimRealPage_OLD.tsx

# Use new version
mv src/components/pages/SimRealPage_Updated.tsx src/components/pages/SimRealPage.tsx
```

### Option B: Manual Migration

If you want to keep existing SimRealPage code, copy these sections from `SimRealPage_Updated.tsx`:

1. **Import the new engine**:
   ```tsx
   import { createSimRealTradingEngine, SimRealTradingEngine, SimRealPosition } from '../../engines/simRealTradingEngine';
   import PrivateKeyVault from '../PrivateKeyVault';
   ```

2. **Add engine refs and state**:
   ```tsx
   const engineRef = useRef<SimRealTradingEngine | null>(null);
   const [engineBalance, setEngineBalance] = useState<number>(0);
   const [enginePositions, setEnginePositions] = useState<SimRealPosition[]>([]);
   const [engineStatus, setEngineStatus] = useState<'stopped' | 'running' | 'error'>('stopped');
   ```

3. **Add engine instantiation useEffect** (see lines ~170-230 of SimRealPage_Updated.tsx):
   ```tsx
   useEffect(() => {
     if (!privateKey || walletStatus !== 'connected') return;
     
     const engine = createSimRealTradingEngine({
       privateKey,
       apiKey: apiKey || '',
       rpcUrl: jupiterRpcUrl,
       // ... rest of config
     });
     
     engine.start();
     engineRef.current = engine;
     return () => engine.stop();
   }, [privateKey, walletStatus, /* deps */]);
   ```

4. **Replace old sell handler** with:
   ```tsx
   const handleManualSell = async (mint: string) => {
     if (!engineRef.current) return;
     await engineRef.current.manualSell(mint);
   };
   ```

5. **Replace UI to read from engine**:
   - Change `simRealBalance` → `engineBalance`
   - Change `positions` prop → `enginePositions` state
   - Update position table to call `handleManualSell`

---

## Step 5: Update App.tsx Props (Remove Old Callbacks)

Currently, App.tsx passes these to SimRealPage:
```tsx
<SimRealPage
  // ... props ...
  executeSimRealSell={async (mint) => { /* ... */ }}
  resetSimRealWallet={() => { /* ... */ }}
  simrealControlRef={simrealControlRef}
/>
```

These are now **internal to the engine**. Remove them:

```tsx
<SimRealPage
  // ... props (keep everything else)
  // ❌ Remove: executeSimRealSell
  // ❌ Remove: resetSimRealWallet
  // ❌ Remove: simrealControlRef
/>
```

---

## Step 6: Wire PnLPage → SimRealEngine Buy Signals

This step connects the paper-trading monitor to the real trading engine.

### 6a. Create Signal Bridge in App.tsx

Add a ref for the engine and a callback function:

```tsx
// Near top of App.tsx component
const simRealEngineRef = useRef<any>(null);

// Function to emit buy signals TO the engine
const emitSimRealBuySignal = (
  mint: string,
  symbol: string,
  entryPrice: number,
  buyAmount: number = 0.1
) => {
  if (simRealEngineRef.current?.enqueueBuySignal) {
    console.log(`[App] Emitting buy signal to SimRealEngine: ${symbol}`);
    simRealEngineRef.current.enqueueBuySignal(mint, symbol, entryPrice, buyAmount);
  }
};

// Export as context or pass to PnLPage
```

### 6b. Update PnLPage Props to Accept Signal Emitter

In PnLPage signature:

```tsx
export const PnLPage = ({ 
  // ... existing props ...
  onSimRealBuySignal?: (mint: string, symbol: string, entryPrice: number, amount: number) => void;
}: {
  // ... interface ...
}) => {
```

### 6c. Call Signal When +1% Detected

In PnLPage, around line ~2450 where +1% profit is detected:

```tsx
// BEFORE:
// const result = await executeJupiterSwap(swapConfig, SOL_MINT, mint, amountLamports);
// ... update simRealBought flag ...

// AFTER:
if (onSimRealBuySignal) {
  console.log(`[PnLPage] 🎯 +1% profit detected! Emitting buy signal: ${pos.symbol}`);
  onSimRealBuySignal(
    mint,
    pos.symbol,
    currentPrice,  // entry price
    storeState.buyAmountSol || 0.1  // amount to invest
  );
  
  // Mark in paper ledger that signal was sent
  setActivePositions(prev => ({
    ...prev,
    [mint]: {
      ...prev[mint],
      simRealSignalSent: true,
      simRealSignalTime: Date.now()
    }
  }));
} else {
  console.warn('[PnLPage] No SimRealEngine signal handler available');
}
```

### 6d. Pass Signal Handler from App to PnLPage

```tsx
<PnLPage
  // ... props ...
  onSimRealBuySignal={emitSimRealBuySignal}
/>
```

### 6e. Wire Engine Ref from SimRealPage to App

After creating engine in SimRealPage:

```tsx
// In SimRealPage useEffect where engine is created
useEffect(() => {
  // ... engine creation ...
  engineRef.current = engine;
  
  // NEW: Expose to app-level signal bridge
  if (window.__simRealEngine) {
    window.__simRealEngine.current = engine;
  }
  
  // OR pass via context/callback if you prefer
  onEngineReady?.(engine);
}, [/* deps */]);
```

Then in App.tsx:

```tsx
// After rendering SimRealPage, grab the ref:
// This is the simple approach; better approach would be Context API

// Alternative: pass callback to SimRealPage
<SimRealPage
  // ... props ...
  onEngineReady={(engine) => {
    simRealEngineRef.current = engine;
  }}
/>
```

---

## Step 7: Test Environment Setup

### Create Test Wallet

```bash
# Generate test keypair (save securely!)
solana-keygen new --outfile test-wallet.json

# Fund with ~0.5 SOL from devnet faucet (if testing)
# Or transfer from main wallet if mainnet
```

### Configure Test RPC

Use a **public free RPC** for testing (don't use rate-limited ones):

```
Mainnet:
- https://api.mainnet-beta.solana.com
- https://rpc.ankr.com/solana
- https://solend.genesysgo.net

Devnet (for initial testing):
- https://api.devnet.solana.com
```

### Add to SimRealPage Settings

```tsx
// In SimRealPage UI, set these before starting:
Jupiter RPC URL: https://api.mainnet-beta.solana.com
Private Key: [paste test wallet]
API Key: [optional, for higher rate limits]
Slippage: 1.0%
Stop Loss: -20%
Take Profit: +25%
Buy Amount: 0.1 SOL
```

---

## Step 8: Integration Testing

### Test 1: Key Encryption ✅

```
1. Open SimRealPage
2. Click "Add Private Key"
3. Paste test wallet key
4. Enter password: "test123"
5. Click "Encrypt & Save"
6. Verify key shows as (Locked) with masked display
7. Click "Unlock"
8. Enter password: "test123"
9. Verify key unlocks and shows preview
10. Click "Lock"
11. Verify locked again
```

**Expected**: Key stored encrypted in localStorage, never shown plaintext on screen.

### Test 2: Wallet Connection ✅

```
1. After unlocking key, verify:
   - Wallet status shows "CONNECTED"
   - Wallet address displays correctly
   - SOL balance updates after 30s
2. Switch RPC URL to different endpoint
   - Should disconnect/reconnect
   - Balance should update from new RPC
```

**Expected**: Clean wallet connection with auto-refresh.

### Test 3: Engine Startup ✅

```
1. Verify Engine status shows "RUNNING"
2. Check console logs: should see "[SimRealEngine] Started with balance..."
3. Verify engine monitor loop starts (4s interval check)
```

**Expected**: Engine runs independently once key is unlocked.

### Test 4: Paper-Trade Signal ✅

```
1. In PnLPage scanner, find a token to track
2. Wait for paper position to hit +1% profit
3. Check console: should see "[PnLPage] 🎯 +1% profit detected! Emitting buy signal:"
4. Verify SimRealPage receives signal: "[SimRealEngine] Queued buy signal:"
5. Wait for async execution: "[SimRealEngine] Executing buy:"
```

**Expected**: Signal flows from PnLPage → SimRealEngine without errors.

### Test 5: Real On-Chain Buy ✅

```
1. Monitor transactions as buy executes
2. Check console for: "[SimRealEngine] Executing buy:" and "Buy filled:"
3. Verify on block explorer:
   - TX shows SOL → Token swap
   - Sender is your test wallet
   - Amount matches expected buy (0.1 SOL default)
   - Status: Success
4. Check SimRealPage UI:
   - Balance decreased by 0.1 SOL
   - New position appears in table
   - Position shows token amount, entry price
```

**Expected**: Real swap executes, position tracked, balance updates.

### Test 6: Manual Sell ✅

```
1. Wait for position to be filled (verified on-chain)
2. Click "Sell" button on position row
3. Confirm in dialog
4. Monitor console: "[SimRealEngine] Executing sell:" and "Sell filled:"
5. Verify on block explorer:
   - TX shows Token → SOL swap
   - Amount matches position token count
   - Received SOL matches output
6. Check SimRealPage UI:
   - Position removed from table
   - Balance increased by received SOL
   - P&L calculated correctly
```

**Expected**: Manual sell executes, settlement recorded.

### Test 7: Exit Conditions (SL/TP) — Optional

```
Note: These require price movement during position hold
1. Set Stop Loss: -20%, Take Profit: +25%
2. Monitor position P&L in real-time
3. If price drops 20%: should auto-exit at SL
4. If price rises 25%: should auto-exit at TP
```

**Expected**: Automatic exits trigger without manual intervention.

---

## Step 9: Security Verification

Before going to production, verify:

### Encryption ✅
```
1. Open DevTools → Application → Local Storage
2. Search for "simreal_privateKey"
3. Verify value is encrypted (NOT base58 plaintext)
4. Verify it contains {"version":"1","encrypted":...,"salt":...,"iv":...}
```

**Expected**: Key is encrypted at rest.

### Network Security ✅
```
1. Open DevTools → Network tab
2. Make requests to `/api/jup/quote`, `/api/jup/swap`
3. Verify NO private keys in request body
4. Verify NO API keys in query string (should be in header)
5. Verify HTTPS (all requests to https://...)
```

**Expected**: No secrets exposed in network traffic.

### Memory ✅
```
1. Unlock key in SimRealPage
2. Close SimRealPage tab
3. Verify `engineRef.current` is cleaned up
4. Verify unlocked key cleared from component state
```

**Expected**: No memory leaks of sensitive data.

---

## Step 10: Deployment to Production

Once all tests pass:

### Pre-Production Checklist

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual E2E tests pass with real wallet
- [ ] Security verification complete
- [ ] Code review complete
- [ ] Encrypted keys verified in localStorage
- [ ] Network requests verified for leaks
- [ ] Error handling tested (bad key, bad RPC, insufficient funds, etc.)

### Deploy Steps

```bash
# 1. Create release branch
git checkout -b phase-2-trading-engine

# 2. Commit changes
git add src/lib/keyEncryption.ts
git add src/components/PrivateKeyVault.tsx
git add src/components/pages/SimRealPage.tsx
git add src/engines/simRealTradingEngine.ts
# ... other files ...
git commit -m "Phase 2: Independent trading engine + key encryption"

# 3. Push and create PR
git push origin phase-2-trading-engine

# 4. After review/approval:
git checkout main
git merge phase-2-trading-engine
git push origin main

# 5. Deploy to production
npm run build
# Deploy to your hosting
```

### Post-Deployment

- Monitor logs for any errors
- Test buy/sell flow in production
- Verify balances update correctly
- Check block explorer for all transactions
- Be ready to rollback if critical issues found

---

## Troubleshooting

### "Decryption failed"
- **Cause**: Wrong password entered
- **Fix**: Re-enter password exactly as set

### "Invalid private key format"
- **Cause**: Pasted key is corrupted or incomplete
- **Fix**: Re-copy private key from secure source

### "Wallet status: ERROR"
- **Cause**: RPC URL unreachable or invalid
- **Fix**: Switch to known-good RPC (api.mainnet-beta.solana.com)

### "Buy signal not received"
- **Cause**: PnLPage signal handler not wired
- **Fix**: Verify `onSimRealBuySignal` callback is passed and called

### "Swap failed: Route not found"
- **Cause**: Token not tradeable on Jupiter
- **Fix**: Use fallback USDC routing (automatic in engine)

### "Insufficient balance"
- **Cause**: Engine balance less than buy amount
- **Fix**: Reset wallet to initial balance or send more SOL

### "Engine not running"
- **Cause**: Private key not unlocked or wallet not connected
- **Fix**: Unlock key in PrivateKeyVault, wait for wallet connection

---

## Rollback Plan

If critical issues found in production:

```bash
# Revert to previous version
git revert <commit-hash>
git push origin main

# Clear encrypted keys from affected clients
# Clients can re-add them after fix
```

---

## Performance Targets

After deployment, monitor:

| Metric | Target | Current |
|--------|--------|---------|
| Quote response time | <500ms | TBD |
| Swap execution | <3s | TBD |
| Engine startup | <1s | TBD |
| Balance update latency | <2s | TBD |
| Position tracking accuracy | 100% | TBD |

---

## Next Steps

After Phase 2 deployment:

1. **Phase 3A**: Logging improvements (consolidate Jupiter logs)
2. **Phase 3B**: Token search async optimization
3. **Phase 3C**: Exit monitor enhancements (trailing stops, re-entry)
4. **Phase 4**: Performance profiling & optimization

---

**Ready to deploy? Start with Step 1 (install deps) and work through in order.** 🚀
