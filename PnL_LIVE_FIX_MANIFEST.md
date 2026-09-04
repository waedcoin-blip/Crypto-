# ARINA X-RAY Active Position PnL Live Update Fix

## Root cause
`PnLPage.tsx` reused cached `executableValueSol`, `pnlSol`, and `pnlPercent` during live price updates. Once populated, subsequent price changes did not recalculate PnL.

## Fix
Both active-position live update paths now recalculate display valuation and PnL from the latest market price every time:

- `position.amount * freshPrice`
- `pnlSol = positionValue - entryCostSol`
- `pnlPercent = pnlSol / entryCostSol * 100`

The fix is display-only. It does not authorize TP/SL execution. Automatic trading must continue to use a fresh executable Jupiter quote through `UnifiedExitEngine`.

## Files changed
- `src/components/pages/PnLPage.tsx`

## Validation
This patch is intended to be merged into the current build. After applying, run the project's normal install/lint/build/test commands.
