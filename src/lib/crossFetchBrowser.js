// src/lib/crossFetchBrowser.js
// Native browser fetch adapter for cross-fetch.
// Strictly avoids monkey-patching or property mutation on window or globalThis.

const targetGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {};

const nativeFetch = typeof targetGlobal['fetch'] === 'function'
  ? targetGlobal['fetch'].bind(targetGlobal)
  : fetch;

const nativeHeaders = targetGlobal['Headers'] || Headers;
const nativeRequest = targetGlobal['Request'] || Request;
const nativeResponse = targetGlobal['Response'] || Response;

export default nativeFetch;
export { nativeFetch as fetch };
export { nativeHeaders as Headers };
export { nativeRequest as Request };
export { nativeResponse as Response };
