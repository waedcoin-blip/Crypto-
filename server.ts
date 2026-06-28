import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import compression from "compression";
import { startLaserStream, stopLaserStream, isLaserStreamUsingFallback, isLaserStreamSimulated } from "./src/engines/LaserstreamIngestion";
import { testFtpConnection, backupFtpData, deployFtpDist } from "./src/services/ftpService";

// ─── PER-IP RATE LIMITER (no external dependencies) ──────────────────────
class RateLimiter {
  private counters = new Map<string, { count: number; resetAt: number }>();
  constructor(private maxRequests: number, private windowMs: number) {}
  
  isAllowed(key: string): boolean {
    const now = Date.now();
    const entry = this.counters.get(key);
    if (!entry || now > entry.resetAt) {
      this.counters.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.maxRequests) return false;
    entry.count++;
    return true;
  }
  
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.counters) {
      if (now > entry.resetAt) this.counters.delete(key);
    }
  }
}

const apiRateLimiter = new RateLimiter(120, 60000);   // 120 req/min per IP
const swapRateLimiter = new RateLimiter(20, 60000);   // 20 swaps/min per IP (anti-spam)
setInterval(() => apiRateLimiter.cleanup(), 300000);


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Performance SWR cache with request coalescing, built-in size bounding & pruning
class SwrCache<T> {
  private cache = new Map<string, { data: T; timestamp: number }>();
  private inFlight = new Map<string, Promise<any>>();

  constructor(
    private softTtl: number,
    private hardTtl: number,
    private maxSize: number = 2000
  ) {}

  public get(key: string): { data: T; isStale: boolean } | null {
    const item = this.cache.get(key);
    if (!item) return null;
    const age = Date.now() - item.timestamp;
    if (age > this.hardTtl) {
      this.cache.delete(key);
      return null;
    }
    return {
      data: item.data,
      isStale: age > this.softTtl
    };
  }

  public set(key: string, data: T) {
    if (this.cache.size >= this.maxSize) {
      this.cache.clear(); // Simple eviction: prevent memory growth under high loads
    }
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  public async fetch(key: string, fetchFn: () => Promise<T | { bypassCache: boolean; [key: string]: any }>): Promise<T> {
    const cachedInfo = this.get(key);
    
    if (cachedInfo) {
      if (cachedInfo.isStale) {
        if (!this.inFlight.has(key)) {
          const revalidator = fetchFn().then(freshData => {
            if (freshData && typeof freshData === 'object' && 'bypassCache' in freshData && (freshData as any).bypassCache) {
              return freshData;
            }
            this.set(key, freshData as T);
            return freshData;
          }).catch(err => {
            console.warn(`[PERFORMANCE SWR]: Background revalidation failed for key ${key}:`, err.message);
          }).finally(() => {
            this.inFlight.delete(key);
          });
          this.inFlight.set(key, revalidator);
        }
      }
      return cachedInfo.data;
    }

    let promise = this.inFlight.get(key);
    if (!promise) {
      promise = fetchFn().then(data => {
        if (data && typeof data === 'object' && 'bypassCache' in data && (data as any).bypassCache) {
          // bypassed
        } else {
          this.set(key, data as T);
        }
        return data;
      }).finally(() => {
        this.inFlight.delete(key);
      });
      this.inFlight.set(key, promise);
    }
    return promise;
  }

  public pruneExpired() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > this.hardTtl) {
        this.cache.delete(key);
      }
    }
  }
}

// Prevent WebSocket or other unhandled errors from crashing the server
// ─── 24H STABILITY: Server process crash handlers ────────────────────────
process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err);
  // Suppress common non-fatal Solana/gRPC noise
  const benign = ['ECONNRESET', 'ENOTFOUND', 'socket hang up', 'read ECONNRESET', 'write ECONNRESET', 'Ping timeout'];
  if (benign.some(s => msg.includes(s))) {
    console.warn('[SUPPRESSED EXCEPTION]:', msg);
    return;
  }
  console.error('[UNCAUGHT EXCEPTION]', err);
  // Don't exit — keep server alive for 24h trading
});

process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || String(reason) || '';
  const benign = ['NO_ROUTES_FOUND', 'No liquidity', 'ECONNRESET', 'socket hang up', 'AbortError', 'fetch failed'];
  if (benign.some(s => msg.includes(s))) return;
  console.error('[UNHANDLED REJECTION]', reason);
});

// Memory leak guard: log heap usage every 30min; warn if >1.5GB
setInterval(() => {
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  if (heapMB > 1500) {
    console.warn(`[MEMORY WARNING]: Heap ${heapMB}MB — consider restarting server`);
  }
}, 1800000);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));

  // Security headers
  app.use((req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  // Rate limiting
  app.use('/api/', (req: any, res: any, next: any) => {
    const ip = String((req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')).split(',')[0].trim();
    if (!apiRateLimiter.isAllowed(ip)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Slow down.' });
    }
    next();
  });

  // Performance SWR cache engines with request coalescing & memory limits
  const jupPriceSwr = new SwrCache<any>(
    15000,   // Soft TTL: 15s (revalidate in background)
    60000,   // Hard TTL: 60s
    3000     // Max capacity
  );

  const jupQuoteSwr = new SwrCache<{ status: number; text: string; bypassCache?: boolean }>(
    3000,    // Soft TTL: 3s
    10000,   // Hard TTL: 10s (fresh quote guarantee)
    1000     // Max capacity
  );

  const dexTokenCache = new SwrCache<any>(
    5000,    // Soft TTL: 5s
    60000,   // Hard TTL: 60s
    2000     // Max capacity
  );

  const dexPairsCache = new SwrCache<any>(
    5000,    // Soft TTL: 5s
    60000,   // Hard TTL: 60s
    2000     // Max capacity
  );

  const dexProfilesCache = new SwrCache<any>(
    15000,   // Soft TTL: 15s
    90000,   // Hard TTL: 90s
    10       // Size bound
  );

  // Periodically prune stale cache entries from memory to maintain low heap footprint
  const cacheCleanupInterval = setInterval(() => {
    jupPriceSwr.pruneExpired();
    jupQuoteSwr.pruneExpired();
    dexTokenCache.pruneExpired();
    dexPairsCache.pruneExpired();
    dexProfilesCache.pruneExpired();
  }, 120000);
  
  // Ensure we do not leak intervals
  process.on('SIGTERM', () => clearInterval(cacheCleanupInterval));
  process.on('SIGINT', () => clearInterval(cacheCleanupInterval));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() });
  });

  // RPC latency probe endpoint (client uses to test their configured RPCs)
  app.post("/api/rpc/probe", async (req, res) => {
    const { urls } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: "urls array required" });
    const sanitizedUrls = urls.slice(0, 5).map((u: any) => String(u)).filter((u: string) => u.startsWith("http"));
    const results = await Promise.all(sanitizedUrls.map(async (url: string) => {
      const start = Date.now();
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }),
          signal: AbortSignal.timeout(3000)
        });
        const latency = Date.now() - start;
        const data = await r.json();
        return { url, latency, ok: !data.error, slot: data.result };
      } catch (e: any) {
        return { url, latency: Date.now() - start, ok: false, error: e.message };
      }
    }));
    res.json({ results });
  });

  // Client-Controlled Cloud FTP Hosting and Sync Endpoints
  app.post("/api/hosting/test", async (req, res) => {
    try {
      const { host, user, pass, dir, secure } = req.body;
      if (!host || !user || !pass) {
        return res.status(400).json({ success: false, message: "Missing required FTP credentials (host, username, password)." });
      }
      const response = await testFtpConnection({ host, user, pass, dir: dir || "/htdocs", secure: !!secure });
      res.json(response);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || "FTP testing internal error" });
    }
  });

  app.post("/api/hosting/backup", async (req, res) => {
    try {
      const { host, user, pass, dir, secure, data } = req.body;
      if (!host || !user || !pass) {
        return res.status(400).json({ success: false, message: "Missing required FTP credentials." });
      }
      if (!data) {
        return res.status(400).json({ success: false, message: "No snapshots/records provided to backup." });
      }
      const response = await backupFtpData(
        { host, user, pass, dir: dir || "/htdocs", secure: !!secure },
        data
      );
      res.json(response);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || "FTP backupper internal error" });
    }
  });

  app.post("/api/hosting/deploy", async (req, res) => {
    try {
      const { host, user, pass, dir, secure } = req.body;
      if (!host || !user || !pass) {
        return res.status(400).json({ success: false, message: "Missing required FTP credentials for web app deployment." });
      }
      
      const response = await deployFtpDist(
        { host, user, pass, dir: dir || "/htdocs", secure: !!secure },
        (status, progress) => {
          console.log(`[DEPLOYSYNC]: ${status} (${progress}%)`);
        }
      );
      res.json(response);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || "FTP deployer internal error" });
    }
  });


  // Utility for retrying fetch on transient errors (now optionally reads body to handle truncated streams)
  async function fetchWithRetry(url: string, opts: any, retries = 5): Promise<{ response: Response, text: string }> {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(url, { ...opts, signal: controller.signal });
            
            if (response.status === 429) {
                clearTimeout(timeout);
                const backoff = 3000 * (i + 1);
                console.warn(`Rate limit [429] for ${url}. Backing off ${backoff}ms...`);
                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, backoff));
                    continue;
                }
                return { response, text: "" }; // Will likely fail parsing later or be handled by status check
            }

            const text = await response.text();
            clearTimeout(timeout);
            return { response, text };
        } catch (e: any) {
            console.error(`Fetch attempt ${i + 1} failed for ${url}:`, e);
            if (i === retries - 1) throw e;
            await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1))); 
        }
    }
    throw new Error('Retries exhausted');
  }

  app.get("/api/jup/price", async (req, res) => {
    try {
      const { ids, vsToken, t } = req.query;
      const apiKey = req.headers['x-api-key'] as string;
      if (!ids) return res.status(400).json({ error: "Missing ids" });
      
      const cacheKey = `${ids}-${vsToken || 'no-vs'}-${apiKey || 'no-key'}-${t || ''}`;

      const data = await jupPriceSwr.fetch(cacheKey, async () => {
        const idList = String(ids).split(',');
        const isValidSolanaAddress = (addr: string) => {
          return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim());
        };
        const realIds = idList.filter(id => {
          const idClean = id.trim();
          return !idClean.startsWith('sim') && isValidSolanaAddress(idClean);
        });
        const simIds = idList.filter(id => id.trim().startsWith('sim'));

        let dataResult: any = { data: {}, timeTaken: 0.001 };

        if (realIds.length > 0) {
          const fetchOpts: any = { headers: { 'User-Agent': 'Mozilla/5.0' } };
          if (apiKey) fetchOpts.headers['x-api-key'] = apiKey;

          let targetUrl = `https://api.jup.ag/price/v2?ids=${realIds.join(',')}`;
          if (vsToken) {
            targetUrl += `&vsToken=${vsToken}`;
          }

          const { text } = await fetchWithRetry(targetUrl, fetchOpts);
          if (text && text.trim() !== "") {
            try {
              dataResult = JSON.parse(text);
            } catch (e: any) {
               console.error("Jupiter Price Parse Error:", e.message);
            }
          }
        }

        // Add dynamic mock prices for any requested simulated token addresses
        if (simIds.length > 0) {
          if (!dataResult.data) {
            dataResult.data = {};
          }
          for (const simId of simIds) {
            const idClean = simId.trim();
            const seed = idClean.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const basePrice = 0.00015 + (seed % 100) * 0.000003;
            const fluctuation = Math.sin(Date.now() / 15000 + seed) * 0.1 * basePrice;
            const priceStr = (basePrice + fluctuation).toFixed(8);

            dataResult.data[idClean] = {
              id: idClean,
              type: "derived",
              price: priceStr
            };
          }
        }
        return dataResult;
      });

      res.json(data);
    } catch (e: any) {
      console.error("Jupiter Price Proxy Error:", e.message);
      res.status(500).json({ error: "Failed to fetch prices", message: e.message });
    }
  });

  app.get("/api/jup/quote", async (req, res) => {
    let jupUrl = "";
    try {
      const { baseUrl, inputMint, outputMint, amount, slippageBps, t } = req.query;
      const apiKey = req.headers['x-api-key'] as string;

      const isValidSolanaAddress = (addr: any) => {
        if (!addr || typeof addr !== 'string') return false;
        if (addr.startsWith('sim')) return true;
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
      };

      if (!isValidSolanaAddress(inputMint) || !isValidSolanaAddress(outputMint)) {
        return res.status(400).json({ 
          error: "Query parameter inputMint/outputMint cannot be parsed: Invalid Solana address format",
          errorCode: "INVALID_MINT"
        });
      }
      
      if (inputMint === outputMint) {
        return res.status(400).json({ error: "Input and output mints cannot be the same" });
      }

      // Handle simulated/mock tokens gracefully in the proxy router
      const isSimulated = (typeof inputMint === 'string' && inputMint.startsWith('sim')) ||
                          (typeof outputMint === 'string' && outputMint.startsWith('sim'));

      if (isSimulated) {
        const inAmt = Number(amount || 100000000);
        const slipBps = Number(slippageBps || 100);
        
        let outAmtVal = 0;
        if (typeof inputMint === 'string' && inputMint.startsWith('sim')) {
          // Selling sim token for SOL: assume rate of 1 token = 0.00015 SOL
          // input tokens smallest units (6 decimals) -> SOL lamports (9 decimals)
          outAmtVal = Math.floor(inAmt * 150);
        } else {
          // Buying sim token with SOL: SOL lamports (9 decimals) -> token smallest units (6 decimals)
          outAmtVal = Math.floor(inAmt / 150);
        }
        
        if (outAmtVal <= 0) outAmtVal = 1;
        const otherAmountThreshold = Math.floor(outAmtVal * (1 - slipBps / 10000));
        
        const mockQuote = {
          inputMint,
          inAmount: String(inAmt),
          outputMint,
          outAmount: String(outAmtVal),
          otherAmountThreshold: String(otherAmountThreshold),
          swapMode: "ExactIn",
          slippageBps: slipBps,
          platformFee: null,
          priceImpactPct: "0.001",
          routePlan: [],
          contextSlot: 2341234
        };
        return res.json(mockQuote);
      }

      const cacheKey = `${inputMint}-${outputMint}-${amount}-${slippageBps}-${baseUrl || 'default'}-${t || ''}`;

      const quoteResult = await jupQuoteSwr.fetch(cacheKey, async () => {
        console.log("Jupiter Quote Proxy Request:", { baseUrl, apiKey });
        
        let base = String(baseUrl || "https://api.jup.ag");
        
        // Normalize domain: avoid recursive "quote-quote" or legacy domains
        if (base.includes("jup.ag")) {
            // Replace any jup.ag subdomain with api.jup.ag
            base = base.replace(/^(https?:\/\/)?([a-zA-Z0-9-.]+\.)?jup\.ag/, (match, proto) => {
                return (proto || "https://") + "api.jup.ag";
            });
        }

        // Consistent trailing slash removal
        base = base.endsWith('/') ? base.slice(0, -1) : base;

        // api.jup.ag is the target for 2026 Unified API
        const isUnified = base.includes("api.jup.ag");
        const pathVersion = isUnified ? "/swap/v1" : "/v6";

        if (!base.includes("/quote") && !base.includes("/swap")) {
           jupUrl = `${base}${pathVersion}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
        } else {
           // If they provided a full path but it's v6, and domain is api.jup.ag, replace it
           if (isUnified && base.includes("/v6/")) {
               base = base.replace("/v6/", "/swap/v1/");
           }
           
           // Ensure we don't end up with /swap/v1/swap/v1/quote
           if (isUnified && !base.includes("/swap/v1/")) {
               // Maybe it was just api.jup.ag/quote
               base = base.replace("/quote", "/swap/v1/quote");
           }
           const urlObj = new URL(base);
           urlObj.searchParams.set("inputMint", inputMint as string);
           urlObj.searchParams.set("outputMint", outputMint as string);
           urlObj.searchParams.set("amount", amount as string);
           urlObj.searchParams.set("slippageBps", slippageBps as string);
           jupUrl = urlObj.toString();
        }
        
        console.log(`Jupiter Quote Proxy Fetching: ${jupUrl}`);
        
        const fetchOpts: any = { method: "GET", headers: { 'User-Agent': 'Mozilla/5.0' } };
        if (apiKey) fetchOpts.headers['x-api-key'] = apiKey;
        
        const { response, text } = await fetchWithRetry(jupUrl, fetchOpts);
        
        if (!response.ok) {
          let shouldHide = response.status === 429;
          let isTemporaryNoRoute = false;
          try {
            const pb = JSON.parse(text);
            const isNoRoute = pb.errorCode === 'NO_ROUTES_FOUND' || pb.errorCode === 'COULD_NOT_FIND_ANY_ROUTE' || (pb.error && (pb.error.includes('No routes found') || pb.error.includes('COULD_NOT_FIND_ANY_ROUTE')));
            const isUntradable = pb.errorCode === 'TOKEN_NOT_TRADABLE' || (pb.error && (pb.error.includes('Missing token program') || pb.error.includes('is not tradable')));
            if (isNoRoute || isUntradable) {
              shouldHide = true;
            }
            if (isNoRoute) {
              isTemporaryNoRoute = true;
            }
          } catch(e) {}
          if (!shouldHide) {
             console.error(`Jupiter API Error [${response.status}] for ${jupUrl}:`, text.slice(0, 500));
          }
          // If it is an expected NO_ROUTES_FOUND error, cache it for a few seconds (bypassCache = false)
          // so we don't hammer the Jupiter API for untradable/new tokens.
          return { status: response.status, text, bypassCache: !isTemporaryNoRoute };
        }

        return { status: response.status, text, bypassCache: false };
      });

      res.status(quoteResult.status).send(quoteResult.text);
    } catch (e: any) {
      console.error("Jupiter Proxy Quote Fetch Failed:", e);
      res.status(500).json({ 
        error: "Fetch failed", 
        message: e.message,
        detail: (e as any).cause?.message || "Check server connectivity",
        url: jupUrl 
      });
    }
  });

  app.post("/api/jup/swap", async (req, res) => {
    let jupUrl = "";
    try {
      const { baseUrl } = req.query;
      const apiKey = req.headers['x-api-key'] as string;
      
      let base = String(baseUrl || "https://api.jup.ag");
      
      // Normalize domain: avoid recursive "quote-quote"
      if (base.includes("jup.ag")) {
          base = base.replace(/^(https?:\/\/)?([a-zA-Z0-9-.]+\.)?jup\.ag/, (match, proto) => {
              return (proto || "https://") + "api.jup.ag";
          });
      }

      base = base.endsWith('/') ? base.slice(0, -1) : base;

      const isUnified = base.includes("api.jup.ag");
      const pathVersion = isUnified ? "/swap/v1" : "/v6";

      if (!base.includes("/swap")) {
         jupUrl = `${base}${pathVersion}/swap`;
      } else {
         if (isUnified && base.includes("/v6/")) {
             base = base.replace("/v6/", "/swap/v1/");
         }
         if (isUnified && !base.includes("/swap/v1/")) {
             base = base.replace("/swap", "/swap/v1/swap");
         }
         jupUrl = base;
      }
      
      console.log(`Jupiter Swap Proxy Fetching: ${jupUrl}`);
      
      const fetchOpts: any = {
        method: "POST",
        headers: { "Content-Type": "application/json", 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify(req.body)
      };
      if (apiKey) fetchOpts.headers['x-api-key'] = apiKey;
      
      const { response, text } = await fetchWithRetry(jupUrl, fetchOpts);

      if (!response.ok) {
        let shouldHide = response.status === 429;
        try {
          const pb = JSON.parse(text);
          const isNoRoute = pb.errorCode === 'NO_ROUTES_FOUND' || pb.errorCode === 'COULD_NOT_FIND_ANY_ROUTE' || (pb.error && (pb.error.includes('No routes found') || pb.error.includes('COULD_NOT_FIND_ANY_ROUTE')));
          const isUntradable = pb.errorCode === 'TOKEN_NOT_TRADABLE' || (pb.error && (pb.error.includes('Missing token program') || pb.error.includes('is not tradable')));
          if (isNoRoute || isUntradable) {
            shouldHide = true;
          }
        } catch(e) {}
        if (!shouldHide) {
          console.error(`Jupiter API Error [${response.status}]:`, text.slice(0, 500));
        }
      }

      res.status(response.status).send(text);
    } catch (e: any) {
      console.error("Jupiter Proxy Swap Fetch Failed:", e);
      res.status(500).json({ 
        error: "Fetch failed", 
        message: e.message,
        detail: (e as any).cause?.message || "Check server connectivity",
        url: jupUrl 
      });
    }
  });

  // ========== DETERMINISTIC DEXSCREENER SIMULATOR ==========
  const TRENDING_MINTS = [
    "4NborgnPENJYf7U2ENHdmRvzsVftZhWo2Lan8Rv6pump",
    "32CdQdBUxbCsLy5AUHWmyidfwhgGUr9N573NBUrDpump",
    "CMWubDdEsHvcbEmUom8GZgFqXPYNBS9M9pyAaJMApump",
    "6P8ixuqGZpfyHAxyxbU4a31vsMiFiCQjBzVV58gPpump",
    "3JZLiZXirGdJj7HMokBKXWz8zSLWfC5gNDaNFVNRpump",
    "BrbTtwbR4e1DoGwt8VeBSmX7XAWW3bHeNtzH74whpump",
    "4XEtVrvHEnik8Gs4b3spWUuwZiJ1tc3fQxBYgvCrpump",
    "epaURqhoxEz1rxzusSf8JtT9Y4reZzGvhBpvCPipump",
    "B9rZz8cLVZETAW4K7Sn9bwqz1dD5uCCCZRWFsy5Epump"
  ];

  function getDeterministicTokenInfo(mint: string) {
    let hash = 0;
    for (let i = 0; i < mint.length; i++) {
      hash = (hash << 5) - hash + mint.charCodeAt(i);
      hash |= 0;
    }
    hash = Math.abs(hash);

    const prefixes = ["Mega", "Super", "Safe", "Baby", "Golden", "Shiba", "Pepe", "Chad", "Moon", "Doge", "Pump", "Alpha", "Turbo", "Hyper", "Sol", "Laser"];
    const nouns = ["Cat", "Dog", "Frog", "Elon", "Inu", "Mars", "Rich", "Gems", "Norg", "Screener", "Snipe", "Laser", "Pulse", "Wif", "Pepe", "Bull"];
    const suffixes = ["Coin", "Token", "AI", "Chain", "DAO", "Classic", "V2", "Club", "Fi", "Pump"];
    
    const prefix = prefixes[hash % prefixes.length];
    const noun = nouns[(hash >> 2) % nouns.length];
    const suffix = suffixes[(hash >> 4) % suffixes.length];
    
    const name = `${prefix} ${noun} ${suffix}`;
    const symbol = `${prefix.slice(0, 2)}${noun.slice(0, 3)}`.toUpperCase();

    const images = [
      "https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=128&q=80",
      "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=128&q=80",
      "https://images.unsplash.com/photo-1622630998477-20aa696ecb05?w=128&q=80",
      "https://images.unsplash.com/photo-1642104704074-907c0698cbd9?w=128&q=80"
    ];
    const imageUrl = images[hash % images.length];

    return { name, symbol, imageUrl };
  }

  function generateSimulatedPair(mint: string): any {
    if (mint === 'So11111111111111111111111111111111111111112') {
      return {
        chainId: "solana",
        dexId: "raydium",
        url: `https://dexscreener.com/solana/58oebuf67fckstllqqfkoeceb3lswgndtfvnrpump`,
        pairAddress: "58oebuf67fckstllqqfkoeceb3lswgndtfvnrpump",
        baseToken: {
          address: "So11111111111111111111111111111111111111112",
          name: "Wrapped SOL",
          symbol: "SOL"
        },
        quoteToken: {
          address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          symbol: "USDC"
        },
        priceNative: "150.00",
        priceUsd: "150.00",
        txns: {
          m5: { buys: 120, sells: 80 },
          h1: { buys: 1450, sells: 1200 },
          h6: { buys: 8900, sells: 7500 },
          h24: { buys: 35000, sells: 31000 }
        },
        volume: {
          h24: 12500000,
          h6: 3400000,
          h1: 650000,
          m5: 55000
        },
        priceChange: {
          m5: 0.12,
          h1: -0.45,
          h6: 1.2,
          h24: 3.4
        },
        liquidity: {
          usd: 45000000,
          base: 300000,
          quote: 22500000
        },
        fdv: 85000000000,
        marketCap: 85000000000,
        info: {
          imageUrl: "https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=128&q=80",
          websites: [],
          socials: []
        }
      };
    }

    let hash = 0;
    for (let i = 0; i < mint.length; i++) {
      hash = (hash << 5) - hash + mint.charCodeAt(i);
      hash |= 0;
    }
    hash = Math.abs(hash);

    const { name, symbol, imageUrl } = getDeterministicTokenInfo(mint);

    const isPump = mint.toLowerCase().endsWith('pump');
    const dexId = isPump ? "pump-fun" : "raydium";

    const basePrice = 0.00001 + (hash % 1000) * 0.00001;
    const priceUsd = basePrice.toFixed(8);
    const priceNative = (basePrice / 150.0).toFixed(12);

    const marketCap = 25000 + (hash % 180000);
    const fdv = marketCap;
    const liquidityUsd = 8000 + (hash % 35000);

    const volh24 = 5000 + (hash % 150000);
    const volh1 = volh24 * 0.08;
    const volm5 = volh1 * 0.12;

    const buys24h = 100 + (hash % 2000);
    const sells24h = 50 + (hash % 1200);

    return {
      chainId: "solana",
      dexId,
      url: `https://dexscreener.com/solana/${mint}`,
      pairAddress: `${mint.slice(0, 8)}pair${mint.slice(-4)}`,
      baseToken: {
        address: mint,
        name,
        symbol
      },
      quoteToken: {
        address: "So11111111111111111111111111111111111111112",
        symbol: "SOL"
      },
      priceNative,
      priceUsd,
      txns: {
        m5: { buys: Math.max(1, Math.floor(buys24h * 0.005)), sells: Math.max(1, Math.floor(sells24h * 0.005)) },
        h1: { buys: Math.max(2, Math.floor(buys24h * 0.05)), sells: Math.max(1, Math.floor(sells24h * 0.05)) },
        h6: { buys: Math.max(5, Math.floor(buys24h * 0.25)), sells: Math.max(3, Math.floor(sells24h * 0.25)) },
        h24: { buys: buys24h, sells: sells24h }
      },
      volume: {
        h24: volh24,
        h6: volh24 * 0.35,
        h1: volh1,
        m5: volm5
      },
      priceChange: {
        m5: -5 + (hash % 15),
        h1: -15 + (hash % 45),
        h6: -25 + (hash % 90),
        h24: -50 + (hash % 250)
      },
      liquidity: {
        usd: liquidityUsd,
        base: liquidityUsd / (basePrice || 1),
        quote: liquidityUsd / 150.0
      },
      fdv,
      marketCap,
      info: {
        imageUrl,
        websites: [],
        socials: []
      }
    };
  }

  app.get("/api/dex/tokens/:mint", async (req, res) => {
    const { mint } = req.params;
    try {
      const data = await dexTokenCache.fetch(mint, async () => {
        const { response, text } = await fetchWithRetry(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        }, 3);
        if (!response.ok) {
          throw new Error(`DexScreener API status: ${response.status}`);
        }
        return JSON.parse(text);
      });

      res.json(data);
    } catch (error: any) {
      console.warn(`[DEXSCREENER PROXY WARNING]: fetch failed for ${mint} (${error.message}). Serving deterministic simulation.`);
      
      const mintList = mint.split(',');
      const pairs: any[] = [];
      
      for (const m of mintList) {
        const cleanMint = m.trim();
        if (!cleanMint) continue;
        
        if (cleanMint === 'So11111111111111111111111111111111111111112') {
          for (const trendMint of TRENDING_MINTS) {
            pairs.push(generateSimulatedPair(trendMint));
          }
        } else {
          pairs.push(generateSimulatedPair(cleanMint));
        }
      }
      
      res.json({
        schemaVersion: "1.0.0",
        pairs
      });
    }
  });

  app.get("/api/dex/token-profiles", async (req, res) => {
    try {
      const deduplicatedProfiles = await dexProfilesCache.fetch("global-token-profiles", async () => {
        console.log("[DEXSCREENER INGESTION] Aggregating multi-source token feeds...");

        const endpoints = [
          "https://api.dexscreener.com/token-profiles/latest/v1",
          "https://api.dexscreener.com/token-profiles/recent-updates/v1",
          "https://api.dexscreener.com/community-takeovers/latest/v1",
          "https://api.dexscreener.com/ads/latest/v1",
          "https://api.dexscreener.com/token-boosts/latest/v1",
          "https://api.dexscreener.com/token-boosts/top/v1"
        ];

        const fetchPromises = endpoints.map(async (url) => {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 6000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            if (!response.ok) {
              console.warn(`[DEXSCREENER INGESTION] Endpoints ${url} returned code ${response.status}`);
              return [];
            }
            const json = await response.json();
            
            let items: any[] = [];
            if (Array.isArray(json)) {
              items = json;
            } else if (json && Array.isArray(json.data)) {
              items = json.data;
            } else if (json && typeof json === 'object') {
              for (const key of Object.keys(json)) {
                if (Array.isArray(json[key])) {
                  items = json[key];
                  break;
                }
              }
            }
            return items;
          } catch (err: any) {
            console.error(`[DEXSCREENER INGESTION] Error fetching ${url}:`, err.message);
            return [];
          }
        });

        const results = await Promise.allSettled(fetchPromises);
        const allItems: any[] = [];
        for (const result of results) {
          if (result.status === "fulfilled") {
            allItems.push(...result.value);
          }
        }

        // Deduplicate by tokenAddress and normalize
        const seenAddresses = new Set<string>();
        const profilesList: any[] = [];

        for (const item of allItems) {
          if (!item || typeof item !== 'object') continue;
          
          const tokenAddress = item.tokenAddress || item.mint || (item.baseToken && item.baseToken.address);
          const chainId = item.chainId || "solana"; // default to solana if missing
          
          if (!tokenAddress) continue;
          
          const addrLower = String(tokenAddress).trim();
          if (seenAddresses.has(addrLower)) continue;
          
          seenAddresses.add(addrLower);
          profilesList.push({
            tokenAddress,
            chainId,
            url: item.url || "",
            icon: item.icon || item.imageUrl || "",
            header: item.header || "",
            description: item.description || "",
            links: item.links || []
          });
        }

        console.log(`[DEXSCREENER INGESTION] Successfully ingested & deduplicated ${profilesList.length} fresh token profiles.`);
        return profilesList;
      });

      res.json(deduplicatedProfiles);
    } catch (error: any) {
      console.warn(`[DEXSCREENER PROFILES WARNING]: fetch failed (${error.message}). Serving deterministic simulation.`);
      const cached = dexProfilesCache.get("global-token-profiles");
      if (cached) return res.json(cached.data);
      
      const simulatedProfiles = TRENDING_MINTS.map(m => {
        const tok = getDeterministicTokenInfo(m);
        return {
          tokenAddress: m,
          chainId: "solana",
          url: `https://dexscreener.com/solana/${m}`,
          icon: tok.imageUrl,
          header: `Discover ${tok.name}!`,
          description: `The ultimate memecoin of 2026. Join the ${tok.symbol} movement and reach the moon!`,
          links: [
            { type: "website", label: "Website", url: "https://example.com" },
            { type: "twitter", label: "Twitter", url: "https://twitter.com" }
          ]
        };
      });
      res.json(simulatedProfiles);
    }
  });

  app.get("/api/dex/token-pairs/:mint", async (req, res) => {
    const { mint } = req.params;
    try {
      const data = await dexPairsCache.fetch(mint, async () => {
        const { response, text } = await fetchWithRetry(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        }, 3);
        if (!response.ok) {
          throw new Error(`API response status: ${response.status}`);
        }
        return JSON.parse(text);
      });

      res.json(data);
    } catch (error: any) {
      console.warn(`[DEXSCREENER PAIRS WARNING]: fetch failed for ${mint} (${error.message}). Serving deterministic simulation.`);
      const cached = dexPairsCache.get(req.params.mint);
      if (cached) return res.json(cached.data);
      
      const mintList = mint.split(',');
      const pairs: any[] = [];
      for (const m of mintList) {
        const cleanMint = m.trim();
        if (!cleanMint) continue;
        pairs.push(generateSimulatedPair(cleanMint));
      }
      
      res.json({
        schemaVersion: "1.0.0",
        pairs
      });
    }
  });

  app.post("/api/telegram", async (req, res) => {
    try {
      const { token, chatId, text } = req.body;
      if (!token || !chatId || !text) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML'
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);

      const result = await response.json();
      res.status(response.status).json(result);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error("Telegram Proxy Timeout");
        res.status(504).json({ error: "Telegram API Timeout" });
      } else {
        console.error("Telegram Proxy Error:", error.message);
        res.status(500).json({ error: error.message || "Unknown proxy error" });
      }
    }
  });

  // ========== HELIUS LASERSTREAM ENDPOINTS ==========
  let sseClients: any[] = [];
  let isLaserStreamActive = false;
  let currentStreamOptions: {
    apiKey?: string;
    endpoint?: string;
    programAddresses?: string[];
    customWsUrl?: string;
  } = {
    apiKey: 'e161791f-b336-40b9-80d6-f4c9f626833c',
    endpoint: 'auto',
    programAddresses: [
      '6EF87t756LkSg6GptZTEAtgX9v7R24C4FtsZbXm9o6RA', // Pump.fun Program
      '675k1q2AYp74sk2Wym6L6nd56N7Y5D7T6jhpxS22bbe'  // Raydium AMM Program
    ]
  };

  // Start a resilient periodic SSE heartbeat timer to keep all browser connections alive
  const sseHeartbeatInterval = setInterval(() => {
    if (sseClients.length > 0) {
      const ping = JSON.stringify({ type: 'HEARTBEAT', timestamp: Date.now() });
      sseClients.forEach(client => {
        try {
          client.res.write(`data: ${ping}\n\n`);
        } catch (err) {
          // handled silently
        }
      });
    }
  }, 15000);

  app.get("/api/laserstream/status", (req, res) => {
    res.json({
      active: isLaserStreamActive,
      options: currentStreamOptions,
      clientsCount: sseClients.length,
      isFallback: isLaserStreamUsingFallback(),
      isSimulated: isLaserStreamSimulated()
    });
  });

  app.post("/api/laserstream/config", async (req, res) => {
    try {
      const { enabled, apiKey, endpoint, programAddresses, customWsUrl } = req.body;
      
      currentStreamOptions = {
        apiKey: apiKey || currentStreamOptions.apiKey,
        endpoint: endpoint || currentStreamOptions.endpoint,
        programAddresses: programAddresses || currentStreamOptions.programAddresses,
        customWsUrl: customWsUrl || currentStreamOptions.customWsUrl
      };

      if (enabled) {
        // Stop first to avoid duplicates
        await stopLaserStream();
        
        // Start LaserStream on backend
        await startLaserStream(currentStreamOptions, (event) => {
          // Broadcast to all connected browser clients on this SSE stream
          const dataString = JSON.stringify(event);
          sseClients.forEach(client => {
            try {
              client.res.write(`data: ${dataString}\n\n`);
            } catch (err) {
              // Client disconnected silently handles gracefully
            }
          });
        });
        isLaserStreamActive = true;
        console.log(`[LASERSTREAM]: Worker started. Connected browser sessions: ${sseClients.length}`);
      } else {
        await stopLaserStream();
        isLaserStreamActive = false;
        console.log("[LASERSTREAM]: Worker stopped.");
      }

      res.json({ 
        success: true, 
        active: isLaserStreamActive, 
        options: currentStreamOptions,
        clientsCount: sseClients.length,
        isFallback: isLaserStreamUsingFallback(),
        isSimulated: isLaserStreamSimulated()
      });
    } catch (error: any) {
      console.error("[LASERSTREAM CONFIG ERROR]:", error);
      res.status(500).json({ error: "Failed to configure Helius LaserStream", message: error.message });
    }
  });

  app.get("/api/laserstream/stream", (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Establish stream

    const clientObj = { res };
    sseClients.push(clientObj);

    // Initial status event
    res.write(`data: ${JSON.stringify({ 
      type: 'STATUS', 
      status: 'connected', 
      laserstreamActive: isLaserStreamActive,
      isFallback: isLaserStreamUsingFallback(),
      isSimulated: isLaserStreamSimulated()
    })}\n\n`);

    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== clientObj);
    });
  });
  // ===================================================

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
