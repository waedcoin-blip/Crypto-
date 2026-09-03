// server/utils/polyfill.ts
// Ensure global environment has browser-like primitives expected by third-party SDKs (e.g. @jup-ag/api)
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}
if (typeof (global as any).window === 'undefined') {
  (global as any).window = globalThis;
}
if (typeof globalThis.self === 'undefined') {
  (globalThis as any).self = globalThis;
}
if (typeof (global as any).self === 'undefined') {
  (global as any).self = globalThis;
}
