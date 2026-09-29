/**
 * 35 — Which provider actually served? The failover is IN THE TRACE.
 *
 * The four resilience decorators (`withRetry`, `withFallback`,
 * `fallbackProvider`, `withCircuitBreaker`) sit OUTSIDE the run: a consumer
 * composes them at startup, long before any `run()` exists, and
 * `LLMProvider` is a deliberately minimal port with no emit channel. So
 * three DECLARED events — `agentfootprint.fallback.triggered`,
 * `agentfootprint.error.retried`, `agentfootprint.error.recovered` — were
 * legal types that nothing ever fired, and a trace could not answer the
 * first question asked after a vendor blip: *which provider actually served
 * this call?*
 *
 * Since v7.8 the decorators REPORT what they did through an optional
 * per-call `LLMCallHooks`, and agentfootprint's in-run LLM call sites
 * translate each report into the already-declared event from INSIDE the
 * traversal — so it carries the real `runId` / `runtimeStageId` footprintjs
 * stamped and correlates with everything else in the run. Nothing to wire:
 * subscribe with `.on()` and the events are there.
 *
 * Five scenes:
 *   1. A dead primary and a fallback that serves → `fallback.triggered`
 *      names BOTH providers, and the meta is real (not the synthetic
 *      `consumer-emit#0` / `consumer-scope` a consumer-level emit gets).
 *   2. A flaky provider that recovers on attempt 3 → two `error.retried`
 *      (with backoff + an error classification) and one `error.recovered`.
 *   3. The production stack — breaker under fallback under retry —
 *      captured by `recordRun()`, so the whole failover survives into a
 *      saved recording. This scene also shows the honest limit: the
 *      breaker has NO event of its own; its trip rides the enclosing
 *      fallback's `reason`.
 *   4. Outside a run nothing is emitted. The `onFallback` / `onRetry` /
 *      `onStateChange` hooks still fire, and a non-agentfootprint call
 *      path can hand the decorators its own `onResilience` sink.
 *   5. A STREAMING vendor that answers 429 before its first chunk is
 *      re-opened under the same policy (`error.retried` → `error.recovered`,
 *      every token once); one that fails AFTER a chunk is not retried —
 *      re-sending would replay tokens the caller has already shown.
 *
 * Offline + deterministic: hand-written providers, no API key, no network,
 * 1 ms backoff.
 *
 * Run:  npm run example examples/features/35-resilience-visibility.ts
 */

import { Agent } from '../../src/index.js';
import { recordRun } from '../../src/doors/observe.js';
import { withCircuitBreaker, withFallback, withRetry } from '../../src/doors/resilience.js';
import type {
  LLMCallHooks,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../src/adapters/types.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/35-resilience-visibility',
  title: 'Resilience visibility — which provider actually served',
  group: 'features',
  description:
    'The provider decorators report what they did, so the three declared events (fallback.triggered / error.retried / error.recovered) now fire from inside the run with real runId + runtimeStageId. Shows a failover, a retry-then-recover, the whole stack inside a recordRun() recording, and the honest limits (the breaker has no event of its own; outside a run nothing is emitted).',
  // The point of this example is providers that FAIL on purpose, so it
  // builds its own — injecting a working one would erase the demo.
  providerSlots: [],
  defaultInput: 'is the service up?',
  tags: [
    'feature',
    'resilience',
    'fallback',
    'retry',
    'circuit-breaker',
    'events',
    'observability',
  ],
};

// ── Providers: deliberately unreliable ───────────────────────────────

const answer = (content: string): LLMResponse => ({
  content,
  toolCalls: [],
  usage: { input: 8, output: 4 },
  stopReason: 'stop',
});

const oneTurn: LLMRequest = { messages: [{ role: 'user', content: 'hi' }], model: 'mock' };

/** A vendor that is down: every call throws. `status` feeds the retry policy. */
function downProvider(name: string, message: string, status?: number): LLMProvider {
  return {
    name,
    complete: async () => {
      const err = new Error(message);
      if (status !== undefined) Object.assign(err, { status });
      throw err;
    },
  };
}

/** Throws for the first `failTimes` calls, then serves. */
function flakyProvider(opts: {
  name: string;
  failTimes: number;
  content?: string;
  status?: number;
}): LLMProvider {
  let calls = 0;
  return {
    name: opts.name,
    complete: async () => {
      calls += 1;
      if (calls <= opts.failTimes) {
        const err = new Error(`${opts.name} 503: upstream unavailable (call ${calls})`);
        if (opts.status !== undefined) Object.assign(err, { status: opts.status });
        throw err;
      }
      return answer(opts.content ?? 'Everything is up.');
    },
  };
}

/** A vendor that always serves. */
function healthyProvider(name: string, content: string): LLMProvider {
  return { name, complete: async () => answer(content) };
}

/** Fail loudly so CI catches a regression instead of printing a happy log. */
function mustBe(ok: boolean, what: string): void {
  if (!ok) throw new Error(`REGRESSION: ${what}`);
}

/**
 * A real in-run emit carries the ids footprintjs stamped BEFORE the stage
 * ran. A consumer-level `runner.emit()` would carry the synthetic stand-ins
 * below instead — which is exactly why the decorators do not route through
 * one. `runtimeStageId` is `[subflowPath/]stageId#executionIndex`.
 */
function isRealCorrelation(stage: string, runId: string): boolean {
  return (
    stage !== 'consumer-emit#0' && runId !== 'consumer-scope' && /#\d+$/.test(stage) && runId !== ''
  );
}

// ── Scene 1: the failover is visible ─────────────────────────────────

interface Failover {
  readonly primary: string;
  readonly fallback: string;
  readonly reason: string;
  readonly stage: string;
  readonly runId: string;
}

async function sceneFailover(input: string): Promise<{
  reply: string;
  failovers: Failover[];
}> {
  // #region subscribe
  const provider = withFallback(
    downProvider('acme-llm', 'acme 503: gateway timeout'),
    healthyProvider('backup-llm', 'Everything is up.'),
  );
  const agent = Agent.create({ provider, model: 'mock', maxIterations: 2 }).build();

  // Subscribe BEFORE run() — the dispatcher DROPS events nobody listens for,
  // so a late listener looks exactly like a missing emitter.
  const failovers: Failover[] = [];
  agent.on('agentfootprint.fallback.triggered', (e) => {
    failovers.push({
      primary: e.payload.primary, // the vendor that failed
      fallback: e.payload.fallback, // the vendor that actually served
      reason: e.payload.reason, // the failing vendor's error message
      stage: e.meta.runtimeStageId, // real, stamped by footprintjs
      runId: e.meta.runId,
    });
  });

  const reply = await agent.run({ message: input });
  // #endregion subscribe

  return { reply: String(reply), failovers };
}

// ── Scene 2: the retries and the recovery ────────────────────────────

interface Retried {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly reason: string;
  readonly lastError: string;
}

async function sceneRetryThenRecover(): Promise<{
  reply: string;
  retried: Retried[];
  recovered: { attempt: number; totalDurationMs: number }[];
  realCorrelation: boolean;
}> {
  // Two 503s, then it serves. 1 ms backoff keeps the example instant.
  const provider = withRetry(
    flakyProvider({ name: 'acme-llm', failTimes: 2, status: 503, content: 'Back online.' }),
    { maxAttempts: 4, initialDelayMs: 1 },
  );
  const agent = Agent.create({ provider, model: 'mock', maxIterations: 2 }).build();

  const retried: Retried[] = [];
  const recovered: { attempt: number; totalDurationMs: number }[] = [];
  let realCorrelation = true;

  // The whole family in one subscription — domain wildcards work here
  // because these are ordinary registered events.
  agent.on('agentfootprint.error.*', (e) => {
    realCorrelation &&= isRealCorrelation(e.meta.runtimeStageId, e.meta.runId);
    if (e.type === 'agentfootprint.error.retried') {
      retried.push({
        attempt: e.payload.attempt, // 1-based attempt ABOUT TO START (2 = first retry)
        maxAttempts: e.payload.maxAttempts,
        backoffMs: e.payload.backoffMs,
        // A classification OF THE ERROR ('http-5xx' here), not of the retry
        // decision: shouldRetry returns a bare boolean, so a custom
        // predicate's reasoning is unknowable to the decorator.
        reason: e.payload.reason,
        lastError: e.payload.lastError,
      });
    } else if (e.type === 'agentfootprint.error.recovered') {
      recovered.push({
        attempt: e.payload.attempt, // the attempt that finally worked
        totalDurationMs: e.payload.totalDurationMs,
      });
    }
  });

  const reply = await agent.run({ message: 'try again' });
  return { reply: String(reply), retried, recovered, realCorrelation };
}

// ── Scene 3: the production stack, in a saved recording ──────────────

async function sceneRecordedStack(): Promise<{
  reply: string;
  sequence: string[];
  reasons: string[];
  eventsInRecording: number;
  allCorrelated: boolean;
}> {
  // The standard production composition, bottom-up:
  //   breaker  — stop hammering a vendor that is down (opens after 1 failure here)
  //   fallback — route to the secondary when the primary throws
  //   retry    — retry the WHOLE chain, with backoff
  const provider = withRetry(
    withFallback(
      withCircuitBreaker(downProvider('acme-llm', 'acme 503: gateway timeout'), {
        failureThreshold: 1,
        cooldownMs: 60_000,
      }),
      flakyProvider({ name: 'backup-llm', failTimes: 1, content: 'Served by the backup.' }),
    ),
    { maxAttempts: 3, initialDelayMs: 1 },
  );

  const agent = Agent.create({ provider, model: 'mock', maxIterations: 2 }).build();
  // recordRun subscribes to '*' and wires the boundary recorder — call it
  // BEFORE run(), a recording cannot be reconstructed afterwards.
  const recorder = recordRun(agent);

  const reply = await agent.run({ message: 'status?' });
  const recording = recorder.toRecording();
  recorder.stop();

  const family = new Set([
    'agentfootprint.fallback.triggered',
    'agentfootprint.error.retried',
    'agentfootprint.error.recovered',
  ]);
  const resilienceEvents = recording.events.filter((e) => family.has(e.type));

  return {
    reply: String(reply),
    // The order these landed in IS the story of the call.
    sequence: resilienceEvents.map((e) => e.type.replace('agentfootprint.', '')),
    reasons: resilienceEvents
      .filter((e) => e.type === 'agentfootprint.fallback.triggered')
      .map((e) => (e.payload as { reason: string }).reason),
    eventsInRecording: recording.events.length,
    allCorrelated: resilienceEvents.every((e) =>
      isRealCorrelation(e.meta.runtimeStageId, e.meta.runId),
    ),
  };
}

// ── Scene 4: outside a run — the honest limit ────────────────────────

async function sceneStandalone(): Promise<{
  consumerHooks: string[];
  ownSink: string[];
}> {
  // No Agent, no run, no dispatcher: nothing hands the decorators an
  // `LLMCallHooks`, so every report site short-circuits and NO event is
  // emitted anywhere. The consumer-owned hooks are unchanged.
  const consumerHooks: string[] = [];
  const bare = withRetry(
    withFallback(
      withCircuitBreaker(downProvider('acme-llm', 'acme 503: gateway timeout'), {
        failureThreshold: 1,
        onStateChange: (state, why) => consumerHooks.push(`breaker → ${state} (${why})`),
      }),
      flakyProvider({ name: 'backup-llm', failTimes: 1 }),
      { onFallback: (err) => consumerHooks.push(`onFallback: ${(err as Error).message}`) },
    ),
    {
      maxAttempts: 3,
      initialDelayMs: 1,
      onRetry: (_err, attempt, ms) => consumerHooks.push(`onRetry: attempt ${attempt} in ${ms}ms`),
    },
  );
  await bare.complete(oneTurn);
  // Freeze the list here: the second call below fires these same hooks too,
  // and mixing the two would blur which call did what.
  const fromBareCall = consumerHooks.slice();

  // A non-agentfootprint call path can still collect the same reports by
  // passing its own sink — `LLMCallHooks` is exactly what the in-run call
  // sites pass, so nothing here is a private back door.
  // #region standalone
  const ownSink: string[] = [];
  const hooks: LLMCallHooks = {
    onResilience: (report) =>
      ownSink.push(
        report.kind === 'fell-back'
          ? `${report.kind}: ${report.primary} → ${report.fallback}`
          : report.kind,
      ),
  };
  await bare.complete(oneTurn, hooks);
  // #endregion standalone

  return { consumerHooks: fromBareCall, ownSink };
}

// ── Scene 5: a stream retried before its first chunk, never after ─────

/**
 * A streaming vendor. Each call to `stream()` plays the next script: a number
 * is an HTTP status thrown at connect (before any chunk), a string list is
 * the tokens it streams, and `'drop'` inside it is a reset mid-stream.
 */
function streamingProvider(
  name: string,
  scripts: (number | string[])[],
): {
  provider: LLMProvider;
  opened: () => number;
} {
  let calls = 0;
  const provider: LLMProvider = {
    name,
    complete: async () => answer('(complete path unused)'),
    stream: async function* (): AsyncGenerator<LLMChunk> {
      const script = scripts[Math.min(calls, scripts.length - 1)]!;
      calls += 1;
      if (typeof script === 'number') {
        throw Object.assign(new Error(`${name} ${script} at connect (call ${calls})`), {
          status: script,
        });
      }
      let tokenIndex = 0;
      for (const token of script) {
        if (token === 'drop') {
          throw Object.assign(new Error(`${name} 503: reset mid-stream`), { status: 503 });
        }
        yield { tokenIndex: tokenIndex++, content: token, done: false };
      }
      yield { tokenIndex, content: '', done: true, response: answer(script.join('')) };
    },
  };
  return { provider, opened: () => calls };
}

async function sceneStreamRetry(): Promise<{
  reply: string;
  tokens: string[];
  sequence: string[];
  opened: number;
  midStream: { error: string; opened: number; tokens: string[] };
}> {
  // #region stream-retry
  // Rate-limited at connect, then it streams. Same policy as complete().
  const vendor = streamingProvider('acme-llm', [429, ['Back', ' online.']]);
  const provider = withRetry(vendor.provider, { maxAttempts: 3, initialDelayMs: 1 });
  const agent = Agent.create({ provider, model: 'mock', maxIterations: 2 }).build();

  const sequence: string[] = [];
  const tokens: string[] = [];
  agent.on('agentfootprint.error.*', (e) => sequence.push(e.type.replace('agentfootprint.', '')));
  agent.on('agentfootprint.stream.token', (e) => {
    sequence.push('stream.token');
    tokens.push(e.payload.content);
  });
  const reply = String(await agent.run({ message: 'is the service up?' }));
  // sequence: error.retried → error.recovered → stream.token → stream.token
  // #endregion stream-retry

  // A reset AFTER the first token is the stream's own failure: re-opening
  // would show "Back" twice, so it surfaces exactly as before.
  const dropping = streamingProvider('acme-llm', [['Back', 'drop']]);
  const guarded = withRetry(dropping.provider, { maxAttempts: 3, initialDelayMs: 1 });
  const midTokens: string[] = [];
  const midAgent = Agent.create({ provider: guarded, model: 'mock', maxIterations: 2 }).build();
  midAgent.on('agentfootprint.stream.token', (e) => midTokens.push(e.payload.content));
  let error = '';
  try {
    await midAgent.run({ message: 'is the service up?' });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return {
    reply,
    tokens,
    sequence,
    opened: vendor.opened(),
    midStream: { error, opened: dropping.opened(), tokens: midTokens },
  };
}

// ── Main runner ──────────────────────────────────────────────────────

export async function run(input: string): Promise<unknown> {
  console.log('\n=== Resilience visibility: which provider actually served? ===\n');

  console.log('1. A dead primary, a fallback that serves');
  const s1 = await sceneFailover(input);
  for (const f of s1.failovers) {
    console.log(`   ${f.primary} → ${f.fallback}  (${f.reason})`);
    console.log(`   stamped at ${f.stage} in run ${f.runId}`);
  }
  console.log(`   reply: ${s1.reply}`);
  mustBe(s1.failovers.length === 1, `expected 1 fallback event, got ${s1.failovers.length}`);
  mustBe(s1.failovers[0]!.primary === 'acme-llm', 'fallback event named the wrong primary');
  mustBe(s1.failovers[0]!.fallback === 'backup-llm', 'fallback event named the wrong server');
  mustBe(
    isRealCorrelation(s1.failovers[0]!.stage, s1.failovers[0]!.runId),
    'fallback event carried synthetic meta — it did not come from inside the run',
  );

  console.log('\n2. Two 503s, then it recovers');
  const s2 = await sceneRetryThenRecover();
  for (const r of s2.retried) {
    console.log(
      `   retried  attempt ${r.attempt}/${r.maxAttempts} in ${r.backoffMs}ms  [${r.reason}]  ${r.lastError}`,
    );
  }
  for (const r of s2.recovered) {
    console.log(`   recovered on attempt ${r.attempt} after ${r.totalDurationMs}ms`);
  }
  console.log(`   reply: ${s2.reply}`);
  mustBe(s2.retried.length === 2, `expected 2 retried events, got ${s2.retried.length}`);
  mustBe(s2.retried[0]!.attempt === 2, 'first retry should report the attempt about to start (2)');
  mustBe(
    s2.retried[0]!.reason === 'http-5xx',
    `expected reason http-5xx, got ${s2.retried[0]!.reason}`,
  );
  mustBe(s2.recovered.length === 1, `expected 1 recovered event, got ${s2.recovered.length}`);
  mustBe(s2.recovered[0]!.attempt === 3, 'recovery should name the attempt that worked (3)');
  mustBe(s2.realCorrelation, 'an error.* event carried synthetic meta');

  console.log('\n3. breaker + fallback + retry, captured by recordRun()');
  const s3 = await sceneRecordedStack();
  console.log(`   ${s3.sequence.join(' → ')}`);
  console.log(`   reply: ${s3.reply}`);
  console.log(`   ${s3.eventsInRecording} events in the recording, all with real correlation ids`);
  // The breaker has no event of its own: the SECOND fallback's reason is
  // the CircuitOpenError it threw. That is the only place a trip shows up.
  const breakerTrip = s3.reasons.find((r) => r.includes('circuit breaker is OPEN'));
  console.log(`   breaker trip, visible only via the fallback's reason:`);
  console.log(`     ${breakerTrip ?? '(not this run)'}`);
  mustBe(
    s3.sequence.join(',') === 'fallback.triggered,error.retried,fallback.triggered,error.recovered',
    `unexpected event sequence: ${s3.sequence.join(',')}`,
  );
  mustBe(breakerTrip !== undefined, 'the breaker trip did not surface as a fallback reason');
  mustBe(s3.allCorrelated, 'a recorded resilience event carried synthetic meta');

  console.log('\n4. Outside a run: no events at all — the hooks still fire');
  const s4 = await sceneStandalone();
  for (const line of s4.consumerHooks) console.log(`   ${line}`);
  console.log(`   a call that passes its OWN LLMCallHooks sees: ${s4.ownSink.join(', ')}`);
  mustBe(s4.consumerHooks.length > 0, 'the standalone consumer hooks did not fire');
  mustBe(s4.ownSink.length > 0, 'a consumer-supplied onResilience sink saw nothing');

  console.log('\n5. A stream rate-limited at connect is retried; one that dies mid-stream is not');
  const s5 = await sceneStreamRetry();
  console.log(`   ${s5.sequence.join(' → ')}`);
  console.log(`   stream opened ${s5.opened}×, reply: ${s5.reply}`);
  console.log(
    `   mid-stream reset: opened ${s5.midStream.opened}×, tokens ${JSON.stringify(
      s5.midStream.tokens,
    )}, error: ${s5.midStream.error}`,
  );
  mustBe(
    s5.sequence.join(',') === 'error.retried,error.recovered,stream.token,stream.token',
    `unexpected stream sequence: ${s5.sequence.join(',')}`,
  );
  mustBe(s5.opened === 2, `expected the stream opened twice, got ${s5.opened}`);
  mustBe(s5.tokens.join('') === s5.reply, 'the streamed tokens do not join to the reply');
  mustBe(s5.midStream.opened === 1, 'a stream that failed after a chunk was re-opened');
  mustBe(s5.midStream.error.includes('reset mid-stream'), 'the mid-stream failure was swallowed');

  console.log('\nOK — the failover is in the trace, with the run it belongs to.');
  return {
    failover: s1.failovers,
    retryThenRecover: { retried: s2.retried, recovered: s2.recovered },
    recordedSequence: s3.sequence,
    standalone: s4,
    streamRetry: s5,
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
