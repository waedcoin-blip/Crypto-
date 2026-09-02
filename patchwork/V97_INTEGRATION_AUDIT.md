# V97 Integration Audit Patch

## Purpose
V97 adds an integration-audit guard around the highest-risk paths discovered after a healthy gRPC connection remained `IDLE` with `Recv Slot: ---`.

## What V97 verifies
- A successful `subscribe()` call immediately establishes transport health.
- The 60-second quiet-stream policy remains intact.
- Quiet filtered activity degrades health instead of forcing disconnect/reconnect.
- Receive-slot telemetry remains wired into the UI.
- The unsafe broad `business` error classifier cannot silently return.

## Important limitation
`CONNECTED + IDLE + Recv Slot ---` proves only that the client believes the subscription transport was established. It does **not** prove that Helius is delivering updates matching the request. V97 therefore keeps this as a live integration diagnostic rather than fabricating slot values.

## Required live test
1. Deploy with a valid LaserStream credential.
2. Confirm `CONNECTED` immediately after subscription creation.
3. Capture backend logs for the exact subscription request and endpoint (never the API key).
4. Wait for slot, ping/pong, or transaction updates.
5. If `Recv Slot` remains `---`, inspect provider-side subscription/filter semantics before changing the watchdog.

## Commands
```bash
npm run test:integration-audit
npm run test:laserstream
npm run lint
npm run build
```
