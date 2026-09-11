// scripts/patch-bigint-buffer.cjs
// Buffer polyfill check / no-op
if (typeof BigInt !== 'undefined' && typeof Buffer !== 'undefined') {
  // Ensure Buffer exists globally if needed
}
