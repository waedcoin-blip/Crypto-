export class SourceHealthMonitor {
    static instance;
    sources = new Map();
    eventCounters = new Map();
    rateTimer = null;
    constructor() {
        const supportedSources = [
            'PULSE_FEED',
            'LASERSTREAM',
            'HELIUS_WSS',
            'HELIUS_GRPC',
            'PUMP_FUN',
            'DEXSCREENER',
            'MANUAL',
            'SIMULATION',
        ];
        for (const src of supportedSources) {
            this.sources.set(src, {
                source: src,
                connected: false,
                status: 'DISCONNECTED',
                lastEventAt: null,
                eventsPerSec: 0,
                totalEventsReceived: 0,
                candidatesDiscovered: 0,
                qualifiedCount: 0,
                buyAttempts: 0,
                buysConfirmed: 0,
                buysFailed: 0,
                rejectionsCount: 0,
                errorCount: 0,
            });
            this.eventCounters.set(src, { current: 0, prev: 0 });
        }
        this.startRateCalculator();
    }
    static getInstance() {
        if (!SourceHealthMonitor.instance) {
            SourceHealthMonitor.instance = new SourceHealthMonitor();
        }
        return SourceHealthMonitor.instance;
    }
    startRateCalculator() {
        this.rateTimer = setInterval(() => {
            const now = Date.now();
            for (const [src, stats] of this.sources.entries()) {
                const counters = this.eventCounters.get(src);
                if (counters) {
                    stats.eventsPerSec = counters.current - counters.prev;
                    counters.prev = counters.current;
                }
                // Determine connectivity & status based on recent activity
                if (stats.lastEventAt) {
                    const ageMs = now - stats.lastEventAt;
                    if (ageMs < 10000) {
                        stats.connected = true;
                        stats.status = stats.errorCount > 10 ? 'DEGRADED' : 'ONLINE';
                    }
                    else if (ageMs < 60000) {
                        stats.connected = true;
                        stats.status = 'STALE';
                    }
                    else {
                        stats.connected = false;
                        stats.status = 'DISCONNECTED';
                    }
                }
            }
        }, 1000);
    }
    recordEvent(source, latencyMs) {
        const stats = this.sources.get(source);
        if (!stats)
            return;
        stats.totalEventsReceived++;
        stats.lastEventAt = Date.now();
        stats.connected = true;
        stats.status = 'ONLINE';
        if (latencyMs !== undefined) {
            stats.latencyMs = latencyMs;
        }
        const counters = this.eventCounters.get(source);
        if (counters) {
            counters.current++;
        }
    }
    recordCandidate(source) {
        const stats = this.sources.get(source);
        if (stats)
            stats.candidatesDiscovered++;
    }
    recordQualified(source) {
        const stats = this.sources.get(source);
        if (stats)
            stats.qualifiedCount++;
    }
    recordBuyAttempt(source) {
        const stats = this.sources.get(source);
        if (stats)
            stats.buyAttempts++;
    }
    recordBuyConfirmed(source) {
        const stats = this.sources.get(source);
        if (stats)
            stats.buysConfirmed++;
    }
    recordBuyFailed(source, error) {
        const stats = this.sources.get(source);
        if (stats) {
            stats.buysFailed++;
            if (error) {
                stats.lastError = error;
            }
        }
    }
    recordRejection(source, reason) {
        const stats = this.sources.get(source);
        if (stats) {
            stats.rejectionsCount++;
        }
    }
    recordError(source, error) {
        const stats = this.sources.get(source);
        if (stats) {
            stats.errorCount++;
            stats.lastError = error;
            stats.status = 'DEGRADED';
        }
    }
    setConnectionStatus(source, connected, status) {
        const stats = this.sources.get(source);
        if (stats) {
            stats.connected = connected;
            if (status) {
                stats.status = status;
            }
            else {
                stats.status = connected ? 'ONLINE' : 'DISCONNECTED';
            }
        }
    }
    getSnapshot() {
        const all = {};
        for (const [src, stats] of this.sources.entries()) {
            all[src] = { ...stats };
        }
        return all;
    }
    getStats(source) {
        if (source) {
            return this.sources.get(source) || {
                source,
                connected: false,
                status: 'DISCONNECTED',
                lastEventAt: null,
                eventsPerSec: 0,
                totalEventsReceived: 0,
                candidatesDiscovered: 0,
                qualifiedCount: 0,
                buyAttempts: 0,
                buysConfirmed: 0,
                buysFailed: 0,
                rejectionsCount: 0,
                errorCount: 0,
            };
        }
        const all = {};
        for (const [src, stats] of this.sources.entries()) {
            all[src] = { ...stats };
        }
        return all;
    }
}
export const sourceHealthMonitor = SourceHealthMonitor.getInstance();
