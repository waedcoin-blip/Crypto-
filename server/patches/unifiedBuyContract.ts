/**
 * Arina X-Ray — Unified Multi-Source BUY Contract
 *
 * This module is intentionally dependency-light. It documents/enforces the
 * invariants that every real discovery source must satisfy before reaching
 * the authoritative BUY engine.
 */

export const LIVE_DISCOVERY_SOURCES = [
  'PULSE_FEED',
  'LASERSTREAM',
  'HELIUS_WSS',
  'HELIUS_GRPC',
  'PUMP_FUN',
  'DEXSCREENER',
] as const;

export type LiveDiscoverySource = typeof LIVE_DISCOVERY_SOURCES[number];

export function isLiveDiscoverySource(source: string): source is LiveDiscoverySource {
  return (LIVE_DISCOVERY_SOURCES as readonly string[]).includes(source);
}

/** Simulation/manual data must never be treated as live discovery. */
export function canAuthorizeLiveBuy(source: string, tradingMode: string): boolean {
  if (tradingMode !== 'LIVE') return false;
  return isLiveDiscoverySource(source);
}

/**
 * A discovery event must have a real mint and timestamp.
 * Prices/amounts are optional because they must never be fabricated.
 */
export function isValidDiscoveryEvent(event: {
  mint?: unknown;
  timestamp?: unknown;
  source?: unknown;
}): boolean {
  return (
    typeof event.mint === 'string' &&
    event.mint.trim().length > 0 &&
    typeof event.timestamp === 'number' &&
    Number.isFinite(event.timestamp) &&
    typeof event.source === 'string' &&
    isLiveDiscoverySource(event.source)
  );
}
