# v95 LaserStream Stability Fixes

- Removed the overly broad `business` and generic HTTP `403` plan-error classifiers.
- Reserved `disabled` for explicit, recognizable Helius plan/access failures.
- Marks the gRPC transport connected immediately after `subscribe()` successfully returns.
- Increased activity observation threshold from 12 seconds to 60 seconds.
- Missing matching transaction activity now degrades health rather than forcing a disconnect.
- Real stream errors still transition the watchdog to disconnected or disabled according to explicit error classification.
