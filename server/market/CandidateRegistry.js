import { sourceHealthMonitor } from './SourceHealthMonitor.js';
import { canonicalizeSolanaMint } from '../../src/utils/solanaValidators.js';
export class CandidateRegistry {
    static instance;
    // Key: `${network}:${mint}`
    candidates = new Map();
    // Key: eventId (deduplication cache)
    processedEventIds = new Set();
    MAX_EVENT_CACHE = 50000;
    CANDIDATE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL
    constructor() {
        // Periodic cleanup of stale candidate records
        setInterval(() => {
            this.cleanupStaleCandidates();
        }, 60000);
    }
    static getInstance() {
        if (!CandidateRegistry.instance) {
            CandidateRegistry.instance = new CandidateRegistry();
        }
        return CandidateRegistry.instance;
    }
    /**
     * Checks if an event is duplicate by eventId.
     */
    isEventDuplicate(eventId) {
        return this.processedEventIds.has(eventId);
    }
    /**
     * Registers event as processed.
     */
    markEventProcessed(eventId) {
        this.processedEventIds.add(eventId);
        if (this.processedEventIds.size > this.MAX_EVENT_CACHE) {
            const arr = Array.from(this.processedEventIds);
            this.processedEventIds = new Set(arr.slice(arr.length - 25000));
        }
    }
    buildKey(networkOrChain, mint, pool = 'default') {
        return `${networkOrChain}:${mint}:${pool}`;
    }
    /**
     * Ingests or updates a candidate token from any discovery source.
     * Merges sources and preserves the authoritative state.
     */
    registerOrUpdateCandidate(event, network = 'mainnet') {
        const canonicalMint = canonicalizeSolanaMint(event.mint);
        event.mint = canonicalMint; // normalize event in-place just in case
        const pool = event.pool || 'default';
        const key = this.buildKey(network, canonicalMint, pool);
        const fallbackKey = `${network}:${canonicalMint}`;
        const now = Date.now();
        let isNewCandidate = false;
        let candidate = this.candidates.get(key) || this.candidates.get(fallbackKey);
        if (!candidate) {
            const src = event.source;
            isNewCandidate = true;
            candidate = {
                mint: event.mint,
                network,
                pool,
                symbol: event.symbol || event.mint.slice(0, 6).toUpperCase(),
                firstDiscoveredSource: src,
                sources: [src],
                firstDiscoveredAt: now,
                lastEventAt: now,
                state: 'DISCOVERED',
                correlationId: event.correlationId || `corr_${event.source.toLowerCase()}_${event.mint.slice(0, 8)}_${now}`,
            };
            this.candidates.set(key, candidate);
            sourceHealthMonitor.recordCandidate(src);
        }
        else {
            const src = event.source;
            candidate.lastEventAt = now;
            if (pool && pool !== 'default') {
                candidate.pool = pool;
            }
            if (!candidate.sources.includes(src)) {
                candidate.sources.push(src);
            }
            if (event.symbol && (!candidate.symbol || candidate.symbol.startsWith('0x') || candidate.symbol.length > 10)) {
                candidate.symbol = event.symbol;
            }
            // re-key to specific pool if it was default
            this.candidates.set(key, candidate);
        }
        return { candidate, isNewCandidate };
    }
    /**
     * Check if a candidate can attempt a BUY.
     * Rejects if already BUYING, BOUGHT, or actively locked.
     */
    canAttemptBuy(network, mint, pool = 'default') {
        const candidate = this.getCandidate(network, mint, pool);
        if (!candidate) {
            return { allowed: true };
        }
        if (candidate.state === 'BUYING') {
            return { allowed: false, reason: 'BUY_IN_PROGRESS: Token is currently undergoing buy transaction' };
        }
        if (candidate.state === 'BOUGHT') {
            return { allowed: false, reason: 'ALREADY_BOUGHT: Token was already purchased' };
        }
        return { allowed: true };
    }
    /**
     * Transitions candidate state with validation.
     */
    updateCandidateState(network, mint, state, details) {
        const candidate = this.getCandidate(network, mint, details?.pool);
        if (!candidate)
            return;
        candidate.state = state;
        candidate.lastEventAt = Date.now();
        if (details?.score !== undefined)
            candidate.score = details.score;
        if (details?.rejectionReason)
            candidate.rejectionReason = details.rejectionReason;
        if (details?.orderId)
            candidate.buyOrderId = details.orderId;
        if (details?.signature)
            candidate.buySignature = details.signature;
        if (details?.positionId)
            candidate.positionId = details.positionId;
    }
    getCandidate(network, mint, pool = 'default') {
        let canonicalMint;
        try {
            canonicalMint = canonicalizeSolanaMint(mint);
        }
        catch {
            return undefined;
        }
        const key = this.buildKey(network, canonicalMint, pool);
        if (this.candidates.has(key))
            return this.candidates.get(key);
        const fallbackKey = `${network}:${canonicalMint}`;
        if (this.candidates.has(fallbackKey))
            return this.candidates.get(fallbackKey);
        // Search any matching pool key
        for (const [k, c] of this.candidates.entries()) {
            if (k.startsWith(`${network}:${canonicalMint}:`) || k.startsWith(`solana:${canonicalMint}:`)) {
                return c;
            }
        }
        return undefined;
    }
    getAllCandidates(network) {
        const list = Array.from(this.candidates.values());
        if (network) {
            return list.filter((c) => c.network === network);
        }
        return list;
    }
    cleanupStaleCandidates() {
        const now = Date.now();
        for (const [key, candidate] of this.candidates.entries()) {
            if (now - candidate.lastEventAt > this.CANDIDATE_TTL_MS && candidate.state !== 'BUYING') {
                this.candidates.delete(key);
            }
        }
    }
}
export const candidateRegistry = CandidateRegistry.getInstance();
