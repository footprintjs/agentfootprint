/**
 * Offline answer-standing cost on the built package.
 *
 *   node bench/answer/default-cost.mjs
 *
 * Each sample is one recorded Agent.run with a fresh agent and the same mock
 * requests and replies in both arms. The clock covers the run with a recorder
 * attached. Build, record serialization and shutdown are outside that
 * interval. Warm samples alternate arms within a pair and follow
 * four warm-up pairs. Each first-turn sample uses a separate process, after
 * importing the public package and attaching the recorder, before any run.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { Agent, defineTool } from 'agentfootprint';
import { recordRun } from 'agentfootprint/observe';
import { mock } from 'agentfootprint/providers';

const program = fileURLToPath(import.meta.url);
const { version } = createRequire(import.meta.url)('agentfootprint/package.json');
const sizes = { small: 1, medium: 12, large: 48 };
const batchSize = 6;
const message = 'Look up the example entries.';
const reply = 'I ran the lookup.';
const warning = 'Not sure — a lookup came back empty without saying what it searched.';
const arms = ['off', 'default'];
const byteLength = (value) => Buffer.byteLength(JSON.stringify(value));

async function measure(arm, toolCalls) {
  const calls = Array.from({ length: toolCalls }, (_, index) => ({
    id: `lookup-${index + 1}`,
    name: 'lookup_entries',
    args: { page: index + 1, _findings: { basis: 'direct' } },
  }));
  const batches = Array.from({ length: Math.ceil(calls.length / batchSize) }, (_, index) => ({
    toolCalls: calls.slice(index * batchSize, (index + 1) * batchSize),
  }));
  const replies = [...batches, { content: reply }];
  const requests = [];
  const executed = [];
  const builder = Agent.create({
    model: 'mock',
    provider: mock({
      thinkingMs: 0,
      chunkDelayMs: 0,
      respond: ({ signal, ...wire }) => {
        const next = replies[requests.length];
        assert.ok(next, 'unexpected extra request');
        requests.push(JSON.stringify(wire));
        return next;
      },
    }),
    maxIterations: replies.length + 1,
  })
    .tool(
      defineTool({
        name: 'lookup_entries',
        description: 'Read one page of the example entries.',
        inputSchema: {
          type: 'object',
          properties: { page: { type: 'number' } },
          required: ['page'],
        },
        execute: ({ page }) => {
          executed.push(page);
          return page === toolCalls ? [] : [{ page, label: `entry-${page}` }];
        },
      }),
    )
    .findings();
  const agent = (arm === 'off' ? builder.answerLayer(false) : builder).build();
  const recorder = recordRun(agent);

  try {
    const start = performance.now();
    const answer = await agent.run({ message });
    const runMs = performance.now() - start;

    recorder.stop();
    const recording = recorder.toRecording();
    const assessments = recording.events.filter(
      (event) => event.type === 'agentfootprint.answer.assessed',
    );
    const ledger = recording.snapshot.sharedState.findingsLedger;
    assert.equal(requests.length, replies.length);
    assert.deepEqual(
      executed.toSorted((left, right) => left - right),
      calls.map((call) => call.args.page),
    );
    assert.equal(ledger.length, toolCalls);
    assert.equal(recorder.droppedEvents, 0);
    if (arm === 'default') {
      assert.equal(answer, `${reply}\n\n---\n\n${warning}`);
      assert.equal(assessments.length, 1);
      assert.equal(assessments[0].payload.standing, 'not-sure');
      assert.deepEqual(assessments[0].payload.reasons, ['empty-undeclared']);
      assert.ok(ledger.every((row) => row.turn === 1));
    } else {
      assert.equal(answer, reply);
      assert.equal(assessments.length, 0);
    }

    return {
      runMs,
      commitBytes: byteLength(recording.snapshot.commitLog),
      eventBytes: byteLength(recording.events),
      recordingBytes: byteLength(recording),
      commitBundles: recording.snapshot.commitLog.length,
      events: recording.events.length,
      modelRequests: requests.length,
      requestSha256: createHash('sha256').update(JSON.stringify(requests)).digest('hex'),
    };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

async function pair(sample, measureArm, toolCalls) {
  const order = sample % 2 === 0 ? arms : arms.toReversed();
  const [first, second] = order;
  const observations = {
    [first]: await measureArm(first, toolCalls),
    [second]: await measureArm(second, toolCalls),
  };
  assert.equal(observations.default.requestSha256, observations.off.requestSha256);
  return observations;
}

function measureFirstTurn(arm, toolCalls) {
  return JSON.parse(
    execFileSync(process.execPath, [program, '--first-turn', arm, String(toolCalls)], {
      encoding: 'utf8',
    }),
  );
}

function distribution(values) {
  const sorted = values.toSorted((left, right) => left - right);
  const lowerMiddle = Math.floor((sorted.length - 1) / 2);
  const upperMiddle = Math.floor(sorted.length / 2);
  return {
    min: sorted[0],
    median: (sorted[lowerMiddle] + sorted[upperMiddle]) / 2,
    p95: sorted[Math.ceil(0.95 * sorted.length) - 1],
    max: sorted.at(-1),
  };
}

function summarize(samples) {
  return Object.fromEntries(
    ['runMs', 'commitBytes', 'eventBytes', 'recordingBytes'].map((field) => [
      field,
      {
        off: distribution(samples.map((sample) => sample.off[field])),
        default: distribution(samples.map((sample) => sample.default[field])),
        pairedDelta: distribution(
          samples.map((sample) => sample.default[field] - sample.off[field]),
        ),
      },
    ]),
  );
}

async function compareSizes(warmPairCount, firstTurnPairCount) {
  const results = [];
  for (const [size, toolCalls] of Object.entries(sizes)) {
    for (let index = 0; index < 4; index += 1) await pair(index, measure, toolCalls);
    const warmPairs = [];
    for (let index = 0; index < warmPairCount; index += 1) {
      warmPairs.push(await pair(index, measure, toolCalls));
    }
    const firstTurnPairs = [];
    for (let index = 0; index < firstTurnPairCount; index += 1) {
      firstTurnPairs.push(await pair(index, measureFirstTurn, toolCalls));
    }
    const hashes = [...warmPairs, ...firstTurnPairs].map((sample) => sample.off.requestSha256);
    assert.equal(new Set(hashes).size, 1, 'wire bytes moved between samples');
    results.push({
      size,
      toolCalls,
      modelRequests: warmPairs[0].off.modelRequests,
      requestSha256: hashes[0],
      warm: summarize(warmPairs),
      firstTurn: summarize(firstTurnPairs),
      warmPairs,
      firstTurnPairs,
    });
  }
  return results;
}

function count(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  assert.ok(Number.isSafeInteger(parsed) && parsed > 0, 'pair counts must be positive integers');
  return parsed;
}

const [mode, armOrFirstTurnPairs, calls, ...rest] = process.argv.slice(2);
assert.equal(rest.length, 0);
if (mode === '--first-turn') {
  assert.ok(arms.includes(armOrFirstTurnPairs));
  const toolCalls = Number(calls);
  assert.ok(Object.values(sizes).includes(toolCalls));
  console.log(JSON.stringify(await measure(armOrFirstTurnPairs, toolCalls)));
} else {
  assert.equal(
    calls,
    undefined,
    'usage: node bench/answer/default-cost.mjs [warm pairs] [first-turn pairs]',
  );
  const warmPairs = count(mode, 24);
  const firstTurnPairs = count(armOrFirstTurnPairs, 6);
  console.log(
    JSON.stringify(
      {
        packageVersion: version,
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        warmUpPairsPerSize: 4,
        warmPairsPerSize: warmPairs,
        firstTurnPairsPerSize: firstTurnPairs,
        results: await compareSizes(warmPairs, firstTurnPairs),
      },
      null,
      2,
    ),
  );
}
