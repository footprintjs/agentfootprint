/**
 * 65 — "hop 3 of 12": a long-running tool reports progress mid-call (9.52.0).
 *
 * The ask came from a team whose agent walks a dependency graph — one tool
 * call, twelve hops, forty seconds. On the record that call was ATOMIC:
 * `stream.tool_start`, then nothing at all, then `stream.tool_end` with the
 * answer. From outside, a tool that is working and a tool that has hung look
 * exactly the same, and the person watching the screen has no way to tell.
 *
 * `ctx.progress(payload)` is the tool author's own emit door. Each call files
 * one `agentfootprint.stream.tool_progress` event, in call order, always
 * between that call's `tool_start` and its `tool_end`.
 *
 * Four things this example shows, in order:
 *
 *   1. The live feed — `agent.on('agentfootprint.stream.tool_progress')` while
 *      the walk is still running, printing each hop as it lands.
 *   2. Who stamps what — `toolCallId`, `toolName` and `iteration` come from
 *      the FRAMEWORK (a report cannot claim to be from another call); the
 *      `payload` is the tool author's, forwarded verbatim.
 *   3. The same reports over the wire — `toSSE(agent)` carries them to a
 *      browser with no wiring of its own, because the event name already
 *      starts with `agentfootprint.stream.`.
 *   4. The LIVE STATUS LINE (9.54.0) — the same reports as the sentence a chat
 *      bubble shows, through `agent.enable.liveStatus(...)`. Through 9.53.0
 *      this half was missing: the event was on the record and nothing carried
 *      it to the screen, so every consumer wrote their own side channel for
 *      the middle of a long call. The display contract is narrow on purpose —
 *      a top-level string `message` is shown VERBATIM (cut at 120 characters,
 *      and the cut is stated); anything else gets an honest generic line. The
 *      author's payload is never pretty-printed into a human sentence.
 *
 * …and one thing it proves by absence: a second agent whose tool never calls
 * `progress` files zero `tool_progress` events. The feature costs nothing to
 * anyone who does not use it.
 *
 * Progress is TELEMETRY. It never enters the tool result, the history, or
 * anything the model reads — the model still sees exactly one result, at the
 * end, as it always did.
 *
 * Run:  npm run example examples/features/65-tool-progress.ts
 */

import { Agent, defineTool, type LLMProvider, type ToolExecutionContext } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { chatBubbleLiveStatus, toSSE } from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/65-tool-progress',
  title: 'Progressive tool results — "hop 3 of 12" while the tool is still working',
  group: 'features',
  description:
    'A long-running tool calls ctx.progress() mid-execute; each report lands as a typed ' +
    'agentfootprint.stream.tool_progress event — framework-stamped with toolCallId/toolName/' +
    'iteration, author-owned payload — read live from the event stream, off toSSE, and as the ' +
    'live status line a chat bubble shows (a `message` verbatim, anything else generic).',
  defaultInput: 'What does the checkout service depend on?',
  providerSlots: ['default'],
  tags: ['features', 'tools', 'observability', 'streaming', 'events'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

const HOPS = ['api-gateway', 'checkout', 'pricing', 'catalog', 'inventory', 'ledger',
  'payments', 'fraud', 'notify', 'audit', 'search', 'sessions'];

/** The twelve-hop walk. The `for` loop is the whole feature: one report per hop. */
function walkTool(report: boolean) {
  return defineTool({
    name: 'walk_graph',
    description: 'Walk the dependency graph from a root service',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' } },
      required: ['root'],
    },
    execute: async (args: Record<string, unknown>, ctx: ToolExecutionContext) => {
      const visited: string[] = [];
      for (const [i, hop] of HOPS.entries()) {
        await Promise.resolve(); // stand-in for the real hop
        visited.push(hop);
        // The one line. Always present, never throws, never blocks — and with
        // nothing listening it is a no-op that drops the report.
        // `message` is the one field the live status line reads. Everything
        // else still rides to the record untouched — one call, two faces.
        if (report) {
          ctx.progress(
            i % 4 === 3
              ? { message: `Hop ${String(i + 1)} of ${String(HOPS.length)} — ${hop}`, done: i + 1, total: HOPS.length, hop }
              : { done: i + 1, total: HOPS.length, hop },
          );
        }
      }
      return `${String(args.root)} reaches ${String(visited.length)} services: ${visited.join(', ')}`;
    },
  });
}

/** One scripted turn: call the walk once, then answer. */
const oneWalk = (): LLMProvider =>
  mock({
    replies: [
      { toolCalls: [{ id: 'call-walk-1', name: 'walk_graph', args: { root: 'checkout' } }] },
      { content: 'checkout depends on 12 services; the deepest hop is sessions.' },
    ],
  });

function buildAgent(report: boolean, provider?: LLMProvider): Agent {
  return Agent.create({ provider: provider ?? oneWalk(), model: 'small-model', maxIterations: 3 })
    .system('You map service dependencies.')
    .tool(walkTool(report))
    .build();
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // ── 1. The live feed ───────────────────────────────────────────────────
  const reporting = buildAgent(true, provider);
  const order: string[] = [];
  reporting.on('agentfootprint.stream.tool_start', () => order.push('tool_start'));
  reporting.on('agentfootprint.stream.tool_end', () => order.push('tool_end'));

  const reports: Array<{ toolCallId: string; toolName: string; iteration: number; payload: unknown }> = [];
  reporting.on('agentfootprint.stream.tool_progress', (e) => {
    order.push('progress');
    reports.push(e.payload);
    const p = e.payload.payload as { done: number; total: number; hop: string };
    const bar = '█'.repeat(p.done) + '·'.repeat(p.total - p.done);
    console.log(`   [${bar}] ${String(p.done)}/${String(p.total)}  ${p.hop}`);
  });

  console.log('1. walk_graph is running. It is ONE tool call — here is the inside of it:\n');
  const answer = await reporting.run({ message: input });
  if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');
  check(reports.length === HOPS.length, `${String(HOPS.length)} progress reports`);

  // ── 2. Who stamps what ─────────────────────────────────────────────────
  console.log('\n2. Every report is stamped by the FRAMEWORK, not by the tool:');
  const first = reports[0]!;
  console.log(`     toolCallId: ${first.toolCallId}   toolName: ${first.toolName}   iteration: ${String(first.iteration)}`);
  console.log(`     payload:    ${JSON.stringify(first.payload)}   ← the author's, verbatim`);
  check(
    reports.every((r) => r.toolCallId === 'call-walk-1' && r.toolName === 'walk_graph'),
    'every report correlated to the call that made it',
  );
  // Order is the promise: a report that lands after the end is not progress.
  check(order[0] === 'tool_start', 'tool_start first');
  check(order[order.length - 1] === 'tool_end', 'tool_end last');
  check(order.filter((o) => o === 'progress').length === HOPS.length, 'all reports inside the call');
  console.log(`     order:      tool_start → ${String(HOPS.length)} × tool_progress → tool_end`);

  // The model's view is unchanged: it reads ONE result, at the end.
  console.log(`\n     …and the model still read exactly one result. Its answer: ${answer}`);

  // ── 3. The same reports over the wire ──────────────────────────────────
  console.log('\n3. The same reports, over toSSE — no extra wiring, it is a stream.* event:');
  const streamed = buildAgent(true);
  const chunks: string[] = [];
  const sse = toSSE(streamed, { filter: (e) => e.type === 'agentfootprint.stream.tool_progress' });
  const collect = (async () => {
    for await (const c of sse) chunks.push(c);
  })();
  await streamed.run({ message: input });
  await new Promise((r) => setTimeout(r, 10));
  void collect; // the filter drops turn_end, so let the iterator be
  check(chunks.length === HOPS.length, `${String(HOPS.length)} SSE frames`);
  console.log(`     ${chunks[2]!.trim().split('\n').join('\n     ')}`);

  // ── 4. The live status line — what a PERSON sees (9.54.0) ──────────────
  // This is the half that was missing through 9.53.0. `enable.liveStatus`
  // projects the run onto ONE sentence and hands it to whatever renders your
  // chat bubble; mid-call reports now move that sentence.
  console.log('\n4. The same reports as the line a chat bubble shows:');
  const watched = buildAgent(true);
  const statusLines: string[] = [];
  watched.enable.liveStatus({
    strategy: chatBubbleLiveStatus({ onLine: (line) => statusLines.push(line) }),
  });
  await watched.run({ message: input });

  const spoken = statusLines.filter((l) => l.startsWith('Hop '));
  const generic = statusLines.filter((l) => l.includes('reported progress'));
  for (const l of [...spoken.slice(0, 2), ...generic.slice(0, 1)]) console.log(`     "${l}"`);
  // A report that named a `message` speaks for itself; one that did not gets
  // the honest generic line instead of a pretty-printed payload.
  check(spoken.length > 0, 'reports with a `message` shown verbatim');
  check(generic.length > 0, 'reports without one shown as the generic line');
  check(
    statusLines.every((l) => !l.includes('{') && !l.includes('api-gateway')),
    'no payload ever dumped into a human line',
  );
  console.log('     …and never a payload dump: the JSON stays on the record, where it belongs.');

  // ── 5. Zero-cost when unused ───────────────────────────────────────────
  const quiet = buildAgent(false);
  let quietReports = 0;
  const quietLines: string[] = [];
  quiet.enable.liveStatus({
    strategy: chatBubbleLiveStatus({ onLine: (line) => quietLines.push(line) }),
  });
  quiet.on('agentfootprint.stream.tool_progress', () => (quietReports += 1));
  await quiet.run({ message: input });
  check(quietReports === 0, 'no reports from a tool that never calls progress');
  check(
    quietLines.every((l) => !l.includes('reported progress')),
    'a quiet tool’s status line is exactly what it always was',
  );
  console.log('\n5. A tool that never calls progress files ZERO tool_progress events —');
  console.log('   same result, same stream, same status line, nothing to opt out of.');

  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
