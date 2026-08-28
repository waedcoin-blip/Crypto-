// Suppress benign warnings from native addon fallbacks like bigint-buffer
const _origWarn = console.warn;
console.warn = function (...args: any[]) {
  const msg = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
  if (
    msg.includes('bigint: Failed to load bindings') ||
    msg.includes('Failed to load bindings, pure JS will be used')
  ) {
    return;
  }
  _origWarn.apply(console, args);
};

const _origError = console.error;
console.error = function (...args: any[]) {
  const msg = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
  if (
    msg.includes('bigint: Failed to load bindings') ||
    msg.includes('Failed to load bindings, pure JS will be used')
  ) {
    return;
  }
  _origError.apply(console, args);
};

import { isBenignError } from './server/utils/errors.js';
import express from "express";
import path from "path";
import compression from "compression";
import fs from "fs";
import dotenv from "dotenv";


dotenv.config({ path: ".env.local" });
dotenv.config();

import { securityHeaders, corsMiddleware, apiRateLimiter, requestLogger } from "./server/middleware/security.js";
import { globalErrorHandler } from "./server/middleware/errorHandler.js";
import { runLaserstreamWorker } from "./server/engines/LaserstreamIngestion.js";
import { config } from "./server/config/index.js";

// Import Route Handlers
import healthRouter from "./server/routes/health.js";
import rpcRouter from "./server/routes/rpc.js";
import jupiterRouter from "./server/routes/jupiter.js";
import dexscreenerRouter from "./server/routes/dexscreener.js";
import ftpRouter from "./server/routes/ftp.js";
import telegramRouter from "./server/routes/telegram.js";
import laserstreamRouter from "./server/routes/laserstream.js";
import criteriaRouter from "./server/routes/criteria.js";

// Process level crash guard
process.on("uncaughtException", (err: any) => {
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
  
  // Trust proxy for rate limiter to get correct req.ip
  app.set("trust proxy", 1);

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
  app.use("/api/telegram", telegramRouter);
  app.use("/api/laserstream", laserstreamRouter);
  app.use("/api/criteria", criteriaRouter);

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
        const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (config.PORT || 3000);
        app.listen(PORT, "0.0.0.0", () => {
          console.log(`Server running on http://0.0.0.0:${PORT}`);
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
