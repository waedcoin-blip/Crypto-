import re

# 1. Patch server.ts
with open('server.ts', 'r') as f:
    server_content = f.read()

if 'isBenignError' not in server_content:
    server_content = "import { isBenignError } from './server/utils/errors.js';\n" + server_content

old_uncaught = """process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err);
  // Perform safe shutdown here if needed, then exit
  process.exit(1);
});

process.on("unhandledRejection", (reason: any) => {
  console.error("[UNHANDLED REJECTION]", reason);
});"""

new_uncaught = """process.on("uncaughtException", (err: any) => {
  if (isBenignError(err)) {
    console.warn("[BENIGN UNCAUGHT EXCEPTION SUPPRESSED]", err?.message || err);
    return;
  }
  console.error("[UNCAUGHT EXCEPTION]", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason: any) => {
  if (isBenignError(reason)) {
    console.warn("[BENIGN UNHANDLED REJECTION SUPPRESSED]", reason?.message || reason);
    return;
  }
  console.error("[UNHANDLED REJECTION]", reason);
});"""

server_content = server_content.replace(old_uncaught, new_uncaught)

with open('server.ts', 'w') as f:
    f.write(server_content)

# 2. Patch LaserstreamIngestion.ts
with open('server/engines/LaserstreamIngestion.ts', 'r') as f:
    ls_content = f.read()

old_stop_ws = """  if (state.fallbackRawWs) {
    try {
      state.fallbackRawWs.removeAllListeners();
      state.fallbackRawWs.close();
    } catch {
      // Ignore
    }
    state.fallbackRawWs = null;
  }"""

new_stop_ws = """  if (state.fallbackRawWs) {
    try {
      const ws = state.fallbackRawWs;
      ws.removeAllListeners();
      ws.on('error', () => {}); // Prevent unhandled error event on close
      ws.close();
    } catch {
      // Ignore
    }
    state.fallbackRawWs = null;
  }"""

ls_content = ls_content.replace(old_stop_ws, new_stop_ws)

with open('server/engines/LaserstreamIngestion.ts', 'w') as f:
    f.write(ls_content)

print("Server error handlers patched successfully")
