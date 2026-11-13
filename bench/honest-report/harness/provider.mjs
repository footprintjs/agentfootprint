/**
 * bench/honest-report/harness/provider.mjs — the paid provider: the package's own Anthropic
 * adapter over an SDK client the harness builds, recording what the rule asks of every response
 * (RULE.md § 3): the served model id, and how many HTTP attempts the SDK made (its own retries,
 * `maxRetries` 3, are the only retries; RULE.md § 5).
 *
 * NOT exercised by the rehearsal (no network there): the paid run is its first real use. The
 * stub test (`test/bench/honest-report/provider.test.ts`) pins the wrapping against a fake SDK.
 *
 * THE KEY. The SDK reads ANTHROPIC_API_KEY from the environment itself (`node --env-file=…`);
 * this file only checks the variable is set, and never prints, copies or logs it.
 */

import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { PROPOSED } from '../rule-tables.mjs';

/**
 * The SDK client, with a `fetch` that counts attempts. `attemptsSince(n)` says how many HTTP
 * attempts were made since the counter read `n`.
 */
export async function loadSdkClient(sdkFrom) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('--provider anthropic needs ANTHROPIC_API_KEY in the environment (node --env-file=<file>)');
  let mod;
  try {
    mod = await import('@anthropic-ai/sdk');
  } catch {
    // Not installed in this checkout: it is an optional peer of the package.
  }
  if (mod === undefined && sdkFrom !== undefined) mod = createRequire(join(resolve(sdkFrom), 'package.json'))('@anthropic-ai/sdk');
  if (mod === undefined) throw new Error('@anthropic-ai/sdk is not installed in this checkout; pass --sdk-from <dir>');
  const Anthropic = mod.default ?? mod.Anthropic ?? mod;
  const counter = { attempts: 0 };
  const client = new Anthropic({
    timeout: 120_000,
    maxRetries: PROPOSED.sdkMaxRetries,
    fetch: (url, init) => {
      counter.attempts += 1;
      return globalThis.fetch(url, init);
    },
  });
  return { client, counter };
}

/**
 * The provider for one run, over `sdk` (`loadSdkClient`'s result). Each answered request appends
 * `{ servedModel, attempts }` to `served.requests`: for `create` from its response, for `stream`
 * from the stream's final message (the adapter awaits `finalMessage()`; the hook reads the same
 * promise). Every argument the adapter passes (its abort signal) goes through untouched.
 */
export function anthropicProvider(doors, sdk, served) {
  const client = {
    messages: {
      create: async (...args) => {
        const before = sdk.counter.attempts;
        const response = await sdk.client.messages.create(...args);
        served.requests.push({ servedModel: response?.model, attempts: sdk.counter.attempts - before });
        return response;
      },
      stream: (...args) => {
        const before = sdk.counter.attempts;
        const opened = sdk.client.messages.stream(...args);
        const finalMessage = opened.finalMessage.bind(opened);
        let recorded = false;
        opened.finalMessage = async () => {
          const message = await finalMessage();
          if (!recorded) served.requests.push({ servedModel: message?.model, attempts: sdk.counter.attempts - before });
          recorded = true;
          return message;
        };
        return opened;
      },
    },
  };
  return doors.anthropic({ _client: client });
}
