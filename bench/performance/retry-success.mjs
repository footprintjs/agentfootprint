// Optional measurements from an existing local build:
//   node bench/performance/retry-success.mjs
// Both providers are simulated. This script reports measurements without thresholds.
import { performance } from 'node:perf_hooks';
import { staticTokens } from '../../dist/identity/staticTokens.js';
import { withCredentialRetry } from '../../dist/identity/withCredentialRetry.js';
import { withRetry } from '../../dist/resilience/withRetry.js';

const repetitions = 250_000;
const warmupRepetitions = 25_000;
const rounds = 5;
let sink;

async function measure(call, count) {
  const started = performance.now();
  for (let i = 0; i < count; i++) sink = await call();
  return ((performance.now() - started) * 1_000_000) / count;
}

async function compare(name, bare, wrapped) {
  await measure(bare, warmupRepetitions);
  await measure(wrapped, warmupRepetitions);

  const samples = [];
  for (let round = 0; round < rounds; round++) {
    let bareNsPerCall;
    let wrappedNsPerCall;
    if (round % 2 === 0) {
      bareNsPerCall = await measure(bare, repetitions);
      wrappedNsPerCall = await measure(wrapped, repetitions);
    } else {
      wrappedNsPerCall = await measure(wrapped, repetitions);
      bareNsPerCall = await measure(bare, repetitions);
    }
    samples.push({
      bareNsPerCall,
      wrappedNsPerCall,
      extraNsPerCall: wrappedNsPerCall - bareNsPerCall,
    });
  }
  return { name, samples };
}

const credentials = staticTokens({ demo: 'simulated-token' });
const wrappedCredentials = withCredentialRetry(credentials);
const credentialRequest = { service: 'demo' };
const response = {
  content: 'ok',
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
};
const provider = { name: 'mock', complete: async () => response };
const wrappedProvider = withRetry(provider);
const request = { model: 'mock', messages: [{ role: 'user', content: 'hi' }] };

const measurements = [
  await compare(
    'withCredentialRetry.getCredential',
    () => credentials.getCredential(credentialRequest),
    () => wrappedCredentials.getCredential(credentialRequest),
  ),
  await compare(
    'withRetry.complete',
    () => provider.complete(request),
    () => wrappedProvider.complete(request),
  ),
];

console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      repetitions,
      warmupRepetitions,
      measurements,
      sinkUsed: sink !== undefined,
    },
    null,
    2,
  ),
);
