// Build first, then run: node bench/performance/run-latency.mjs
import { performance } from 'node:perf_hooks';
import { LLMCall } from '../../dist/core/LLMCall.js';
import { MockProvider } from '../../dist/adapters/llm/MockProvider.js';

const listenersPerEvent = 10;
const warmupRuns = 10;
const runsPerSample = 80;
const sampleCount = 5;

function makeRunner(listenerCount) {
  const runner = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
    .system('')
    .build();
  for (let i = 0; i < listenerCount; i++) {
    runner.on('agentfootprint.stream.llm_start', () => {});
    runner.on('agentfootprint.stream.llm_end', () => {});
  }
  return runner;
}

async function runMany(runner, runs) {
  for (let i = 0; i < runs; i++) await runner.run({ message: 'x' });
}

async function millisecondsPerRun(runner) {
  const start = performance.now();
  await runMany(runner, runsPerSample);
  return (performance.now() - start) / runsPerSample;
}

const baseline = makeRunner(0);
const observed = makeRunner(listenersPerEvent);
await runMany(baseline, warmupRuns);
await runMany(observed, warmupRuns);

const samples = [];
for (let i = 0; i < sampleCount; i++) {
  let baselineMsPerRun;
  let observedMsPerRun;
  if (i % 2 === 0) {
    baselineMsPerRun = await millisecondsPerRun(baseline);
    observedMsPerRun = await millisecondsPerRun(observed);
  } else {
    observedMsPerRun = await millisecondsPerRun(observed);
    baselineMsPerRun = await millisecondsPerRun(baseline);
  }
  samples.push({
    baselineMsPerRun,
    observedMsPerRun,
    extraMsPerRun: observedMsPerRun - baselineMsPerRun,
  });
}

console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      listenersPerEvent,
      warmupRuns,
      runsPerSample,
      samples,
    },
    null,
    2,
  ),
);
