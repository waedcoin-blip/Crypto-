/** Application-level HTTP client. Never monkey-patches window/globalThis.fetch. */
const nativeFetch = globalThis.fetch.bind(globalThis);

export async function httpFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return nativeFetch(input, init);
}
