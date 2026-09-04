/**
 * Unified multi-source BUY contract regression.
 *
 * This test deliberately does NOT submit a transaction. It verifies that all
 * live discovery sources are eligible for the same BUY authority and that
 * simulation cannot authorize a live BUY.
 */

import {
  LIVE_DISCOVERY_SOURCES,
  canAuthorizeLiveBuy,
  isValidDiscoveryEvent,
} from '../patches/unifiedBuyContract';

const expected = [
  'PULSE_FEED',
  'LASERSTREAM',
  'HELIUS_WSS',
  'HELIUS_GRPC',
  'PUMP_FUN',
  'DEXSCREENER',
];

if (JSON.stringify([...LIVE_DISCOVERY_SOURCES]) !== JSON.stringify(expected)) {
  throw new Error('Unified source registry mismatch');
}

for (const source of expected) {
  if (!canAuthorizeLiveBuy(source, 'LIVE')) {
    throw new Error(`${source} is not eligible for unified LIVE BUY path`);
  }
  if (!isValidDiscoveryEvent({
    source,
    mint: 'TestMint11111111111111111111111111111111111',
    timestamp: Date.now(),
  })) {
    throw new Error(`${source} rejected valid discovery contract`);
  }
}

if (canAuthorizeLiveBuy('SIMULATION', 'LIVE')) {
  throw new Error('Simulation source can authorize live BUY');
}
if (canAuthorizeLiveBuy('PULSE_FEED', 'PAPER')) {
  throw new Error('Paper mode can authorize live BUY');
}

console.log('PASS: unified multi-source BUY contract');
