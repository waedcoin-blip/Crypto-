import express from "express";
import path from "path";
import compression from "compression";
import fs from "fs";
import dotenv from "dotenv";

// ─── MONKEY-PATCH CONSOLE TO SUPPRESS BENIGN METRIC/WS LIMITS ──────────────
const originalConsoleError = console.error;
console.error = function (...args) {
  const msg = args.map(arg => {
    if (arg instanceof Error) {
      return arg.message + '\n' + arg.stack;
    }
    if (arg && typeof arg === 'object') {
      try { return JSON.stringify(arg); } catch (e) { return String(arg); }
    }
    return String(arg);
  }).join(' ');

  const benign = [
    'Unexpected server response', '429', 'ws error', 'WebSocket', 'websocket',
    'failed: WebSocket is closed'
  ];

  if (benign.some(s => msg.includes(s) || msg.toLowerCase().includes(s.toLowerCase()))) {
    return;
  }
  originalConsoleError.apply(console, args);
};

const originalConsoleWarn = console.warn;
console.warn = function (...args) {
  const msg = args.map(arg => String(arg)).join(' ');
  const benign = [
    'Unexpected server response', '429', 'ws error', 'WebSocket', 'websocket'
  ];
  if (benign.some(s => msg.includes(s) || msg.toLowerCase().includes(s.toLowerCase()))) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

dotenv.config({ path: ".env.local" });
dotenv.config();

import { securityHeaders, corsMiddleware, apiRateLimiter, requestLogger } from "./server/middleware/security.js";
import { globalErrorHandler } from "./server/middleware/errorHandler.js";
import { runLaserstreamWorker } from "./server/engines/LaserstreamIngestion.js";

// Import Route Handlers
import healthRouter from "./server/routes/health.js";
import rpcRouter from "./server/routes/rpc.js";
import jupiterRouter from "./server/routes/jupiter.js";
import dexscreenerRouter from "./server/routes/dexscreener.js";
import ftpRouter from "./server/routes/ftp.js";
import telegramRouter from "./server/routes/telegram.js";
import laserstreamRouter from "./server/routes/laserstream.js";

// Process level crash guard for benign connection glitches
process.on("uncaughtException", (err) => {
  const msg = err?.message || String(err);
  const benign = [
    "ECONNRESET", "ENOTFOUND", "socket hang up", "read ECONNRESET", "write ECONNRESET",
    "Ping timeout", "Unexpected server response", "429", "ws error", "WebSocket", "websocket"
  ];
  if (benign.some((s) => msg.includes(s) || msg.toLowerCase().includes(s.toLowerCase()))) {
    return;
  }
  console.error("[UNCAUGHT EXCEPTION]", err);
});

process.on("unhandledRejection", (reason: any) => {
  const msg = reason?.message || String(reason) || "";
  const benign = [
    "NO_ROUTES_FOUND", "No liquidity", "ECONNRESET", "socket hang up", "AbortError",
    "fetch failed", "Unexpected server response", "429", "ws error", "WebSocket", "websocket"
  ];
  if (benign.some((s) => msg.includes(s) || msg.toLowerCase().includes(s.toLowerCase()))) {
    return;
  }
  console.error("[UNHANDLED REJECTION]", reason);
});

async function startServer() {
  if (process.env.IS_LASERSTREAM_WORKER === "true") {
    try {
      await runLaserstreamWorker();
    } catch (e) {
      console.error("Worker start failed:", e);
      process.exit(1);
    }
    return;
  }

  const app = express();

  // Basic Middlewares
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(compression());
  app.use(express.json({ limit: "2mb" }));
  app.use(requestLogger);

  // Rate Limiter
  app.use("/api/", apiRateLimiter);

  // Mount Modular API Routers
  app.use("/api/health", healthRouter);
  app.use("/api/rpc", rpcRouter);
  app.use("/api/jup", jupiterRouter);
  app.use("/api/dex", dexscreenerRouter);
  app.use("/api/hosting", ftpRouter);
  app.use("/api/ftp", ftpRouter);
  app.use("/api/telegram", telegramRouter);
  app.use("/api/laserstream", laserstreamRouter);

  // API Catch-all 404 Handler
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  // Global Error Handler
  app.use(globalErrorHandler);

  // Vite middleware for development vs static production serve
  if (
    !process.env.VERCEL &&
    (process.env.NODE_ENV !== "production" ||
      process.env.VITE_DEV_SERVER === "true" ||
      !fs.existsSync(path.join(process.cwd(), "dist/index.html")))
  ) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return app;
}

const appPromise = startServer();

if (!process.env.VERCEL && process.env.NODE_ENV !== "test") {
  appPromise
    .then((app) => {
      if (app && typeof app.listen === "function") {
        const PORT = 3000;
        app.listen(PORT, "0.0.0.0", () => {
          console.log(`Server running on http://localhost:${PORT}`);
        });
      } else {
        console.log("Server instance is running as worker.");
      }
    })
    .catch(console.error);
}

export default async function handler(req: any, res: any) {
  const app = await appPromise;
  if (app) {
    app(req, res);
  } else {
    res.status(500).json({ error: "Server instance not available" });
  }
}
