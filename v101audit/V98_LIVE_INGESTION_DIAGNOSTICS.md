# v98 Live Ingestion Diagnostics

This patch unifies quiet-stream health at 60 seconds and adds counters to distinguish provider silence from local filtering: raw updates, invalid updates, rejected updates, duplicates, queued updates, and processing failures. A successful gRPC subscription remains transport-connected independently of matching transaction activity.

If `Recv Slot` remains unavailable while `rawUpdatesReceived` grows, inspect the provider update shape/filtering path. If raw updates remain zero, inspect endpoint, credentials, subscription and provider delivery.
