# SimRealPage Integration Guide
## Wiring the Independent Trading Engine

This guide shows the exact code changes needed to make SimRealPage use the new `SimRealTradingEngine`.

---

## Overview

**Current state** (what exists now):
- SimRealPage is a display-only component
- Real trading logic is embedded in PnLPage
- SimRealPage receives props from App.tsx and displays positions/trades

**Target state** (after this integration):
- SimRealPage instantiates and owns `SimRealTradingEngine`
- Engine runs independently, managing real positions/balance
- SimRealPage is purely a UI layer for the engine
- PnLPage emits signals; engine receives them

---

## Step 1: Update SimRealPage Props Interface

**File**: `src/components/pages/SimRealPage.tsx`

Remove the callback props that are no longer needed (engine is internal):

```typescript
// BEFORE
interface SimRealPageProps {
  // ... many props ...
  executeSimRealSell: (mint: string) => Promise<void>;  // ← REMOVE
  resetSimRealWallet: () => void;                        // ← REMOVE
  // ... rest of props ...
}

// AFTER
interface SimRealPageProps {
  // ... same props, but remove executeSimRealSell and resetSimRealWallet
  // (engine will handle these internally)
}
```

---

## Step 2: Import the Engine

**File**: `src/components/pages/SimRealPage.tsx` (top of file)

Add this import:

```typescript
import { createSimRealTradingEngine, SimRealTradingEngine, SimRealPosition } from '../../engines/simRealTradingEngine';
```

---

## Step 3: Create State for Engine Management

Inside the SimRealPage component, after destructuring props:

```typescript
export const SimRealPage: React.FC<SimRealPageProps> = ({
  // ... destructured props ...
}) => {
  // ... existing state (showKey, copiedId, jupiterStatus, etc.) ...

  // NEW: Engine instance
  const engineRef = useRef<SimRealTradingEngine | null>(null);
  const [enginePositions, setEnginePositions] = useState<SimRealPosition[]>([]);
  const [engineBalance, setEngineBalance] = useState<number>(simRealBalance);
  
  // ... rest of component
};
```

---

## Step 4: Instantiate Engine in useEffect

Add this effect hook early in the component (after the wallet check):

```typescript
  // --- ENGINE LIFECYCLE ---
  useEffect(() => {
    if (!privateKey || !jupiterRpcUrl) {
      if (engineRef.current) {
        engineRef.current.stop();
        engineRef.current = null;
      }
      return;
    }

    // Create engine with config
    const engine = createSimRealTradingEngine({
      privateKey: privateKey,
      apiKey: apiKey || '',
      rpcUrl: jupiterRpcUrl.trim() || rpcUrl,
      defaultSlippagePct: slippage,
      initialBalance: simRealBalance,
      stopLoss: stopLoss,
      takeProfit: maxTakeProfit, // or bondingCurveTakeProfit, depending on token stage
      
      // Callbacks for UI updates
      onBuySignal: (signal) => {
        console.log(`[SimRealPage UI] Buy signal received: ${signal.symbol}`);
        // Optional: show toast notification
      },
      
      onPositionUpdate: (position) => {
        console.log(`[SimRealPage UI] Position updated: ${position.symbol}`);
        setEnginePositions((prev) => {
          const updated = prev.filter(p => p.mint !== position.mint);
          return [...updated, position];
        });
      },
      
      onBalanceUpdate: (balance) => {
        console.log(`[SimRealPage UI] Balance updated: ${balance.toFixed(4)} SOL`);
        setEngineBalance(balance);
        setSimRealBalance(balance); // Also update parent store if needed
      },
      
      onTradeComplete: (mint, pnlPct) => {
        console.log(`[SimRealPage UI] Trade closed: P&L ${pnlPct.toFixed(2)}%`);
        // Optional: update trade history UI
      },
      
      onError: (err) => {
        console.error(`[SimRealPage UI] Engine error: ${err.message}`);
        // Show error toast to user
      }
    });

    // Start the engine
    engine.start();
    engineRef.current = engine;

    // Cleanup on unmount or prop change
    return () => {
      if (engineRef.current) {
        engineRef.current.stop();
      }
    };
  }, [privateKey, jupiterRpcUrl, rpcUrl, apiKey, slippage, simRealBalance, stopLoss, maxTakeProfit]);
```

---

## Step 5: Wire PnLPage Buy Signals to Engine

This requires a **signal bridge** from App.tsx. In `App.tsx`:

```typescript
// ADD THIS NEAR TOP (after simrealControlRef definition)
const simRealEngineRef = useRef<any>(null);

// PASS TO PNLPAGE (in the <PnLPage /> component props):
<PnLPage
  // ... existing props ...
  simrealEngineRef={simRealEngineRef}  // NEW: pass ref to engine
/>

// ALSO PASS TO SIMREALPAGE (in the <SimRealPage /> component props):
<SimRealPage
  // ... existing props ...
  simrealEngineRef={simRealEngineRef}  // NEW: pass ref to engine
  // remove: executeSimRealSell, resetSimRealWallet
/>
```

### In PnLPage.tsx

Add this to the component props:

```typescript
export const PnLPage = ({ 
  // ... existing props ...
  simrealEngineRef?: React.MutableRefObject<any>;  // NEW
}: { 
  // ... rest of interface ...
}) => {
```

Then, in the place where PnLPage detects +1% profit and calls the real buy (currently around line ~2466):

```typescript
// INSTEAD OF:
// const result = await executeJupiterSwap(swapConfig, SOL_MINT, mint, amountLamports);
// ... logic that updates simRealBought flag ...

// DO THIS:
if (simrealEngineRef?.current) {
  // Send signal to SimRealPage's independent engine
  console.log(`[PnLPage] Emitting buy signal to SimRealEngine: ${symbol}`);
  simrealEngineRef.current.enqueueBuySignal(
    mint,
    symbol,
    currentPrice,  // entry price
    storeState.buyAmountSol || 0.1  // amount to spend
  );
  // Mark in paper ledger that we sent this signal
  setActivePositions(prev => ({
    ...prev,
    [mint]: {
      ...prev[mint],
      simRealSignalSent: true,  // flag: signal is pending
      simRealSignalTime: Date.now()
    }
  }));
} else {
  console.warn('[PnLPage] SimRealEngine not available, skipping buy signal');
}
```

---

## Step 6: Replace Manual Sell Handler

In SimRealPage, update the manual sell button handler:

```typescript
// BEFORE:
onClick={() => {
  if (simrealControlRef.current?.executeSimRealSell) {
    await simrealControlRef.current.executeSimRealSell(mint);
  }
}}

// AFTER:
onClick={() => {
  if (engineRef.current) {
    engineRef.current.manualSell(mint);
  }
}}
```

---

## Step 7: Update UI to Read from Engine

Replace SimRealPage's display logic to use `engineBalance` and `enginePositions`:

```typescript
// BEFORE:
<div className="text-xl font-black text-emerald-400">
  {simRealBalance.toFixed(4)} SOL
</div>

// AFTER:
<div className="text-xl font-black text-emerald-400">
  {engineBalance.toFixed(4)} SOL
</div>

// AND for positions list:
const activePositions = enginePositions.filter(p => p.status === 'filled');
// Render activePositions instead of the passed-in positions prop
```

---

## Step 8: Handle Reset Wallet

Currently, there's a "Reset Wallet" button. Update it:

```typescript
// BEFORE:
<button onClick={() => simrealControlRef.current?.resetSimRealWallet()}>
  Reset Wallet
</button>

// AFTER:
<button onClick={() => {
  if (engineRef.current) {
    // Engine doesn't have a reset method yet; consider adding:
    // engineRef.current.resetBalance(initialBalance);
    // For now, recreate the engine by resetting state:
    if (engineRef.current) engineRef.current.stop();
    setEngineBalance(simRealBalance);
    setEnginePositions([]);
  }
}}>
  Reset Wallet
</button>
```

---

## Step 9: Monitor Loop Integration (Optional but Recommended)

The engine has a stub `monitorExits()` loop. To make it functional, pass token metrics:

### 9a. Add to Engine Config

```typescript
// In SimRealPage useEffect where engine is created:
const engine = createSimRealTradingEngine({
  // ... existing config ...
  tokenMetrics: tokenMetrics,  // NEW: pass token prices for SL/TP checks
});
```

### 9b. Update SimRealTradingEngine Constructor

```typescript
// In simRealTradingEngine.ts
export interface SimRealTradingConfig {
  // ... existing fields ...
  tokenMetrics?: Record<string, any>;  // NEW
}

private async monitorExits() {
  for (const [mint, position] of this.positions.entries()) {
    if (!this.config.tokenMetrics) continue;
    
    const metric = this.config.tokenMetrics[mint];
    if (!metric) continue;
    
    const currentPrice = metric.priceNative || metric.priceUsd / 150;
    const currentValue = currentPrice * position.tokenAmount;
    const pnlPct = ((currentValue - position.solSpent) / position.solSpent) * 100;
    
    // Check stop loss
    if (pnlPct <= this.config.stopLoss) {
      console.log(`[Engine] ${position.symbol} hit stop loss: ${pnlPct.toFixed(2)}%`);
      await this.executeSell(mint, `stop-loss@${pnlPct.toFixed(2)}%`);
      continue;
    }
    
    // Check take profit
    if (pnlPct >= this.config.takeProfit) {
      console.log(`[Engine] ${position.symbol} hit take profit: ${pnlPct.toFixed(2)}%`);
      await this.executeSell(mint, `take-profit@${pnlPct.toFixed(2)}%`);
      continue;
    }
  }
}
```

---

## Step 10: Clean Up App.tsx Props

In App.tsx, simplify the SimRealPage and PnLPage prop passing:

```typescript
// REMOVE FROM PNLPAGE PROPS:
// - executeSimRealSell (no longer used)

// REMOVE FROM SIMREALPAGE PROPS:
// - executeSimRealSell
// - resetSimRealWallet

// ADD TO BOTH:
// - simrealEngineRef
```

---

## Testing Checklist

- [ ] Engine instantiates on SimRealPage mount
- [ ] Engine stops on unmount
- [ ] PnLPage emits +1% signal
- [ ] Engine receives signal and queues buy
- [ ] Engine executes buy (check block explorer)
- [ ] Engine balance decreases by buy amount
- [ ] Position appears in engine positions list
- [ ] SimRealPage UI updates with new position
- [ ] SimRealPage balance display matches engine balance
- [ ] Manual sell button triggers engine.manualSell()
- [ ] On-chain sell executes
- [ ] P&L calculated correctly
- [ ] Engine balance updated after sell
- [ ] Position removed from list
- [ ] Stop loss triggers if price drops
- [ ] Take profit triggers if price rises

---

## Troubleshooting

**Engine not starting**:
- Check browser console for errors in engine creation
- Verify `privateKey` and `jupiterRpcUrl` are provided
- Ensure `createSimRealTradingEngine` import is correct

**Buy signal not received**:
- Check PnLPage has `simrealEngineRef` prop
- Verify the ref is passed to engine before +1% detection
- Add console.log in the signal emission code

**Sell fails silently**:
- Check engine `onError` callback is being called
- Verify privateKey is still valid (hasn't been rotated)
- Ensure jupiterRpcUrl endpoint is responsive

**Balance not updating**:
- Verify `onBalanceUpdate` callback is firing
- Check `setEngineBalance` state setter works
- Ensure parent store updates if needed

---

## Code Complete Example

Here's a minimal working example of the full integration:

```typescript
// SimRealPage.tsx (simplified)
import React, { useState, useRef, useEffect } from 'react';
import { createSimRealTradingEngine, SimRealTradingEngine, SimRealPosition } from '../../engines/simRealTradingEngine';

export const SimRealPage: React.FC<SimRealPageProps> = ({
  privateKey,
  jupiterRpcUrl,
  rpcUrl,
  apiKey,
  slippage,
  simRealBalance,
  stopLoss,
  maxTakeProfit,
  setSimRealBalance,
  // ... other props ...
}) => {
  const engineRef = useRef<SimRealTradingEngine | null>(null);
  const [engineBalance, setEngineBalance] = useState(simRealBalance);
  const [enginePositions, setEnginePositions] = useState<SimRealPosition[]>([]);

  // Initialize engine
  useEffect(() => {
    if (!privateKey || !jupiterRpcUrl) return;

    const engine = createSimRealTradingEngine({
      privateKey,
      apiKey: apiKey || '',
      rpcUrl: jupiterRpcUrl.trim() || rpcUrl,
      defaultSlippagePct: slippage,
      initialBalance: simRealBalance,
      stopLoss,
      takeProfit: maxTakeProfit,
      onBalanceUpdate: setEngineBalance,
      onPositionUpdate: (pos) => {
        setEnginePositions(prev => {
          const updated = prev.filter(p => p.mint !== pos.mint);
          return [...updated, pos];
        });
      }
    });

    engine.start();
    engineRef.current = engine;

    return () => engine.stop();
  }, [privateKey, jupiterRpcUrl, rpcUrl, apiKey, slippage, simRealBalance, stopLoss, maxTakeProfit]);

  // Render
  return (
    <div>
      <h2>SimReal Wallet</h2>
      <p>Balance: {engineBalance.toFixed(4)} SOL</p>
      
      <h3>Positions ({enginePositions.length})</h3>
      {enginePositions.map(pos => (
        <div key={pos.mint}>
          <span>{pos.symbol}</span>
          <span>{pos.tokenAmount.toFixed(2)} tokens</span>
          <span>${(pos.tokenAmount * pos.boughtPrice).toFixed(2)}</span>
          <button onClick={() => engineRef.current?.manualSell(pos.mint)}>
            Sell
          </button>
        </div>
      ))}
    </div>
  );
};
```

---

That's it! The engine is now independent and SimRealPage is purely a UI layer.
