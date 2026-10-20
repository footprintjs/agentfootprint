/** Loaded only after explicit execution opt-in and full fixture verification. */
import { pinnedModule } from './identity.mjs';
export function liveTransport(consumer, apiKey, network = globalThis.fetch) {
  if (typeof apiKey !== 'string' || !apiKey) throw new Error('pilot key unavailable');
  const sdk = pinnedModule(consumer, '@anthropic-ai/sdk');
  const Anthropic = sdk.default ?? sdk.Anthropic;
  return async (body, options) => {
    // One client per reservation: even an unexpected SDK retry cannot make a
    // second HTTP request on this call's allowance. No configurable destination.
    let used = false;
    const guardedFetch = async (url, init) => {
      if (
        used ||
        String(url) !== 'https://api.anthropic.com/v1/messages' ||
        init?.method !== 'POST'
      )
        throw new Error('pilot network allowance refused');
      used = true;
      const response = await network(url, { ...init, redirect: 'error' });
      const reader = response.body?.getReader();
      if (!reader) throw new Error('pilot response unavailable');
      const chunks = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 131072) {
          await reader.cancel();
          throw new Error('pilot response byte cap');
        }
        chunks.push(value);
      }
      return new Response(Buffer.concat(chunks), {
        status: response.status,
        headers: response.headers,
      });
    };
    const client = new Anthropic({
      apiKey,
      authToken: null,
      baseURL: 'https://api.anthropic.com',
      maxRetries: 0,
      timeout: 45000,
      fetch: guardedFetch,
      logLevel: 'off',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    const timeout = Math.floor(Math.min(options.timeout ?? 45000, 45000));
    // Remaining budgets use performance.now() fractions; SDK timeouts require
    // integers. Round down only, and refuse less than1ms before any dispatch.
    if (!Number.isSafeInteger(timeout) || timeout < 1) throw new Error('pilot deadline');
    return client.messages.create(body, {
      signal: options.signal,
      timeout,
      maxRetries: 0,
    });
  };
}
