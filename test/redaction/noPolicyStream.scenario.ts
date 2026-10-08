/**
 * A no-policy agent's WHOLE event stream, normalized — the scenario behind
 * the byte-identity pin (`agent-redaction.no-policy-golden.test.ts`).
 *
 * It uses only the public API that existed before the redaction work, so the
 * SAME file runs against `main` to produce the golden it is compared with
 * (`fixtures/no-policy-stream.main.json`). The run covers the paths the
 * redaction touched: a declared tool call, a tool the model made up, a call
 * with invalid arguments, a person asked mid-run and the resume, a
 * composition, a consumer's own emit, and a host's fact filed for the run.
 *
 * Normalized: what changes from one run to the next and says nothing about
 * the record's bytes — clock readings, durations, the minted run ids and the
 * engine's run ids (named by their order of appearance) — and nothing else.
 */
import { Agent, askHuman, defineTool, isPaused, Sequence } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

/** Clock readings and durations: the only values a re-run changes. */
const VOLATILE =
  /^(wallClockMs|runOffsetMs|durationMs|totalDurationMs|pausedDurationMs|survivalMs|latencyMs|runStartMs|pausedAt|startedAt|endedAt|timestamp)$/;

function normalize(events: readonly AgentfootprintEvent[]): string {
  const runs = new Map<string, string>();
  const runName = (id: string) => {
    if (!runs.has(id)) runs.set(id, `run#${runs.size + 1}`);
    return runs.get(id) as string;
  };
  const walk = (value: unknown, key: string): unknown => {
    if (typeof value === 'number' && VOLATILE.test(key)) return '<n>';
    if (typeof value === 'string' && /^run-\d+-\d+$/.test(value)) return runName(value);
    if (typeof value === 'string' && /^\d{10,}-\d{10}$/.test(value))
      return runName(`engine:${value}`);
    if (Array.isArray(value)) return value.map((item) => walk(item, key));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v, k)]),
      );
    }
    return value;
  };
  return JSON.stringify(
    events.map((event) => walk({ type: event.type, payload: event.payload, meta: event.meta }, '')),
    null,
    1,
  );
}

function agent() {
  return Agent.create({
    provider: mock({
      chunkDelayMs: 0,
      replies: [
        { toolCalls: [{ id: 'c1', name: 'lookup', args: { ssn: 'SSN-NOPOLICY-1' } }] },
        { toolCalls: [{ id: 'c2', name: 'made_up_tool', args: { note: 'invented' } }] },
        { toolCalls: [{ id: 'c3', name: 'lookup', args: { ssn: 42 } }] },
        { toolCalls: [{ id: 'c4', name: 'confirm', args: { ssn: 'SSN-NOPOLICY-1' } }] },
        { content: 'All checked.' },
      ],
    }),
    model: 'm',
  })
    .tool(
      defineTool<{ ssn: string }, unknown>({
        name: 'lookup',
        description: 'Look a citizen up.',
        inputSchema: {
          type: 'object',
          properties: { ssn: { type: 'string' } },
          required: ['ssn'],
        },
        execute: ({ ssn }) => ({ ssn, found: true }),
      }),
    )
    .tool(
      defineTool<{ ssn: string }, string>({
        name: 'confirm',
        description: 'Ask a person to confirm.',
        inputSchema: { type: 'object', properties: { ssn: { type: 'string' } } },
        execute: ({ ssn }) => askHuman({ question: `Is ${ssn} right?` }),
      }),
    )
    .build();
}

/** The normalized event stream of the scenario. */
export async function noPolicyStream(): Promise<string> {
  const events: AgentfootprintEvent[] = [];
  const a = agent();
  a.on('*', (e) => events.push(e));
  const outcome = await a.run({ message: 'Check SSN-NOPOLICY-1 for me.' });
  if (!isPaused(outcome)) throw new Error('the scenario must pause');
  const runId = (events[0]?.meta as { runId?: string } | undefined)?.runId as string;
  await a.resume(outcome.checkpoint, { answer: 'yes' });
  a.emit('app.custom', { note: 'a consumer fact', ssn: 'SSN-NOPOLICY-1' });
  a.emitAttributed(
    'agentfootprint.artifacts.resolved',
    { ref: 'art_1', via: 'get', kind: 'table', bytes: 10 },
    { sessionId: 's', runId },
  );
  const sequence = Sequence.create()
    .step(
      'first',
      Agent.create({ provider: mock({ chunkDelayMs: 0, reply: 'step one' }), model: 'm' }).build(),
    )
    .build();
  sequence.on('*', (e) => events.push(e));
  await sequence.run({ message: 'compose' });
  return normalize(events);
}
