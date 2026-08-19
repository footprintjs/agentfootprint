/**
 * 63 — The recording carries the map: three routing facts as DATA (9.50.0).
 *
 * These three asks all came from the same place — building a SkillGraph
 * debugger over recordings, and discovering that facts the framework KNEW at
 * run time were on the record only as prose, or not at all:
 *
 *   1. `agentfootprint.skill.graph_declared` — the AUTHOR'S map. Fired once
 *      per run, right after the run manifest: every declared node (id +
 *      catalog description) and edge (from, to, kind), verbatim from the
 *      built graph. Before this, a viewer could only reconstruct edges from
 *      per-hop provenance — which names an edge once it FIRES — so every
 *      topology drawn from a recording had to caption itself "partial".
 *
 *   2. `context.evaluated.cursorMove.reachable` — where the run could go
 *      NEXT, on every move. The gate always knew this set (it writes the
 *      `read_skill` menu and the refusal messages from it); now the move
 *      itself carries it as a typed list, so nobody parses a menu sentence
 *      back into ids. The refusal event's `allowed` is the SAME set — two
 *      events, one truth.
 *
 *   3. `stream.llm_start.systemPromptText` — the ASSEMBLED system prompt,
 *      byte-for-byte as sent. **Opt-in (`recordSystemPrompt: true`), default
 *      OFF — and the default is a privacy decision**: the assembled prompt
 *      carries whatever was injected into it (skill bodies, RAG passages,
 *      memory, per-user instructions), so absent the dial the recording
 *      honestly does NOT contain the string — only its length.
 *
 * The example runs one skill-routed agent on the mock provider, archives the
 * run with `persistRecording`, re-reads the JSON FILE, and shows all three
 * facts surviving the round trip — plus the privacy default, proven on the
 * archived bytes of a second run that never opted in.
 *
 * Run:  npm run example examples/features/63-recording-carries-the-map.ts
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent, defineTool, type LLMProvider } from '../../src/index.js';
import { skillGraph, defineSkill } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import {
  recordRun,
  persistRecording,
  fileRecordingSink,
  type RecordingEnvelope,
} from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/63-recording-carries-the-map',
  title: 'Recording carries the map — declared graph, reachable set, assembled prompt',
  group: 'features',
  description:
    'The three 9.50.0 recording-surface facts: the declared skill graph as data, the typed ' +
    'reachable set on every cursor move, and the opt-in assembled system prompt — all read ' +
    'back from a persisted envelope file, with the privacy default proven on the bytes.',
  defaultInput: 'A customer wants a refund for order 4412.',
  providerSlots: ['default'],
  tags: ['features', 'skill-graph', 'observability', 'recording', 'lens', 'privacy'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

/** One event row as the archive carries it. */
type EventRow = { type: string; payload: Record<string, unknown> };

/** Build the routed agent this example records. */
function buildAgent(opts: { recordSystemPrompt: boolean; provider: LLMProvider }): Agent {
  const probe = defineTool({
    name: 'lookup_order',
    description: 'Look an order up by id',
    execute: () => 'order 4412: paid, refundable',
  });
  const triage = defineSkill({
    id: 'triage',
    description: 'first look at any request',
    body: 'Read the request; use lookup_order before promising anything.',
  });
  const billing = defineSkill({
    id: 'billing',
    description: 'refunds and charges',
    body: 'You may promise a refund only for a refundable order.',
  });
  const graph = skillGraph()
    .entry(triage)
    .route(triage, billing, { onToolReturn: 'lookup_order', label: 'order in hand' })
    .build();

  return Agent.create({
    provider: opts.provider,
    model: 'small-model',
    maxIterations: 4,
    ...(opts.recordSystemPrompt && { recordSystemPrompt: true }),
  })
    .system('You are the support desk.')
    .tool(probe)
    .skillGraph(graph)
    .build();
}

/** Run one agent, archive the run, and read the envelope back off the disk. */
async function archive(
  agent: Agent,
  input: string,
  directory: string,
): Promise<{ answer: string; events: EventRow[] }> {
  const recorder = recordRun(agent);
  const answer = await agent.run({ message: input });
  const { id } = await persistRecording(recorder, {
    sink: fileRecordingSink({ directory }),
    run: { complete: true },
  });
  recorder.stop();
  const envelope = JSON.parse(readFileSync(join(directory, id), 'utf8')) as RecordingEnvelope;
  if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');
  return { answer, events: envelope.recording.events as unknown as EventRow[] };
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // A scripted mock: call the tool once (which fires the declared route), then
  // answer — so the recording contains an entry move AND a route hop.
  const script = (): LLMProvider => {
    let i = 0;
    return mock({
      respond: () =>
        ++i === 1
          ? {
              content: 'checking the order first',
              toolCalls: [{ id: 't1', name: 'lookup_order', args: { id: '4412' } }],
              stopReason: 'tool_use' as const,
            }
          : { content: 'Refund approved for order 4412.', toolCalls: [], stopReason: 'stop' as const },
    });
  };

  const directory = mkdtempSync(join(tmpdir(), 'af-recording-map-'));
  try {
    // ── Run 1: opted in. All three facts land in the archive. ──
    const optedIn = buildAgent({ recordSystemPrompt: true, provider: provider ?? script() });
    const { answer, events } = await archive(optedIn, input, directory);

    // 1. The declared map — the author's graph, as data.
    const declared = events.find((e) => e.type === 'agentfootprint.skill.graph_declared');
    check(declared !== undefined, 'the declared map on the record');
    const map = declared!.payload as {
      nodes: Array<{ id: string; description?: string }>;
      edges: Array<{ from: string | null; to: string; kind: string; label?: string }>;
    };
    console.log('1. skill.graph_declared — the author’s map, from the archive:');
    for (const n of map.nodes) console.log(`     [${n.id}] ${n.description ?? ''}`);
    for (const e of map.edges)
      console.log(`     ${e.from ?? 'START'} → ${e.to}  (${e.kind}${e.label ? `: ${e.label}` : ''})`);
    check(map.edges.some((e) => e.from === 'triage' && e.to === 'billing'), 'the declared route');
    check(map.edges.some((e) => e.from === null && e.to === 'triage'), 'the declared entry');

    // 2. The typed reachable set on every cursor move.
    const moves = events
      .filter((e) => e.type === 'agentfootprint.context.evaluated')
      .map((e) => e.payload.cursorMove as { to?: string; by?: string; reachable?: string[] })
      .filter((m) => m !== undefined);
    console.log('\n2. cursorMove.reachable — where the run could go, per move:');
    for (const m of moves) console.log(`     ${m.by} → ${m.to}: reachable [${m.reachable?.join(', ')}]`);
    check(moves[0]?.reachable !== undefined, 'a typed reachable set on the first move');
    check(moves[0]!.reachable!.includes('billing'), "'billing' reachable from 'triage'");

    // 3. The assembled system prompt — present, because THIS run opted in.
    const start = events.find((e) => e.type === 'agentfootprint.stream.llm_start')!;
    const text = start.payload.systemPromptText as string;
    check(typeof text === 'string', 'the assembled prompt on llm_start');
    check(text.includes('You are the support desk.'), 'the base prompt inside it');
    console.log('\n3. systemPromptText (opted in) — first 80 chars, verbatim as sent:');
    console.log(`     ${JSON.stringify(text.slice(0, 80))}…`);

    // ── Run 2: the DEFAULT. The archived bytes carry no prompt text. ──
    const defaulted = buildAgent({ recordSystemPrompt: false, provider: script() });
    const second = await archive(defaulted, input, directory);
    const starts = second.events.filter((e) => e.type === 'agentfootprint.stream.llm_start');
    check(starts.length > 0, 'llm_start events on the default run');
    check(
      starts.every((s) => !('systemPromptText' in s.payload)),
      'NO systemPromptText anywhere in the default archive',
    );
    console.log(
      '\n   …and by DEFAULT (run 2): systemPromptText is absent from the archived bytes —\n' +
      `   only systemPromptChars (${String(starts[0]!.payload.systemPromptChars)}) is on the record. The default is the privacy.`,
    );

    return answer;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
