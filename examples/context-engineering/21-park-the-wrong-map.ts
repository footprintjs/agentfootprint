/**
 * 21 — Park the wrong map: a regex read a noun as a task, and nothing owned
 * the question "is this map still earning its place?"
 *
 * This is a real failure, reproduced. A skill map routes a turn's start with
 * entry rules. A person asked to "find the most recent ZONE redundancy run"
 * — where "zone" is the name of a thing they wanted to FIND, not a task —
 * and a keyword entry put the cursor on the zone-audit skill. The map then
 * behaved exactly as specified: the cursor stays until an edge leaves, no
 * edge could ever fire, and the skill's procedure plus its tools rode every
 * call of a 359,000-token, 30-call turn. Its four tools were never called.
 * 29 of 30 cursor moves were "stay".
 *
 * The fix is NOT a smarter regex, and it is not touching the cursor. It is a
 * second axis, owned by the kernel `.maps()` mounts: ENGAGEMENT. An
 * engagement founded on a guess (a keyword — `lexical`) is renewed only by
 * concrete evidence: the map's own tool called, a declared route fired, the
 * model asking by name. Without corroboration for `renewalGrace` passes the
 * map is PARKED — its prompt and tools stop riding, its cursor does not
 * move, and the skip is on the record by name. The model asking for a skill
 * via `read_skill` re-engages it on the spot, so parking is never a trap.
 *
 * Run it and watch the same turn twice:
 *
 *   npx tsx examples/context-engineering/21-park-the-wrong-map.ts
 *
 *   BEFORE  no .maps()   → the guessed skill rides all six calls.
 *   AFTER   .maps()      → engaged on the guess, parked on call four,
 *                          every later call travels light — and the
 *                          `agentfootprint.map.*` events narrate it.
 */

import { Agent, defineTool } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/21-park-the-wrong-map',
  title: 'Park the wrong map — engagement is orthogonal to the cursor',
  group: 'context-engineering',
  description:
    'Reproduces the keyword-trap failure (an entry regex reads a noun as a ' +
    'task) and runs it twice — without and with the .maps() kernel — showing ' +
    'the wrongly-guessed skill parked after three corroboration-free calls, ' +
    'cursor untouched, on the record.',
  defaultInput: 'find the most recent zone redundancy run',
  providerSlots: ['default'],
  tags: ['context-engineering', 'skill-graph', 'maps', 'showcase'],
};

// ── The map: one keyword-entered audit skill, one routable neighbour ─────

const zoneTool = defineTool({
  name: 'get_zone_info',
  description: 'Zone redundancy audit data.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'zones: fab-a ok, fab-b ok',
});

const buildMap = () => {
  const zoneAudit = defineSkill({
    id: 'zone-audit',
    description: 'audit zoneset redundancy',
    body: 'ZONE AUDIT PROCEDURE: call get_zone_info, classify single-path hosts…',
    tools: [zoneTool],
  });
  const runFinder = defineSkill({
    id: 'run-finder',
    description: 'find and open recorded runs',
    body: 'RUN FINDER: search runs, open the newest match.',
  });
  return skillGraph()
    .entry(zoneAudit, { match: { keywords: ['zone'] } })
    .route(zoneAudit, runFinder)
    .build();
};

/** The screen tool the turn ACTUALLY needs — registry-owned, not the map's. */
const screenOpen = defineTool({
  name: 'screen_open',
  description: 'Open a screen and look at it.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'screen shows: runs list',
});

// ── One scripted turn: five screen calls, then the answer ────────────────

const toolCall = (id: string, name: string) => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
  stopReason: 'tool_use' as const,
});
const replies = [
  toolCall('c1', 'screen_open'),
  toolCall('c2', 'screen_open'),
  toolCall('c3', 'screen_open'),
  toolCall('c4', 'screen_open'),
  toolCall('c5', 'screen_open'),
  { content: 'The most recent zone redundancy run is run-42.', toolCalls: [], stopReason: 'stop' as const },
];

interface Outcome {
  answer: string;
  /** Per iteration: did the zone-audit skill's contribution ride the call? */
  rode: boolean[];
  events: string[];
}

async function driveTurn(withKernel: boolean): Promise<Outcome> {
  const rode: boolean[] = [];
  const events: string[] = [];
  let builder = Agent.create({ provider: mock({ replies: replies as never }), model: 'mock', maxIterations: 8 })
    .system('You help people find and audit things.')
    .tool(screenOpen)
    .skillGraph(buildMap());
  if (withKernel) builder = builder.maps({ renewalGrace: 3 });
  const agent = builder
    .watch({
      id: 'narrator',
      onEmit: (e: { name: string; payload?: unknown }) => {
        const pay = (e.payload ?? {}) as Record<string, unknown>;
        if (e.name === 'agentfootprint.context.evaluated') {
          rode.push(((pay.activeIds as string[]) ?? []).includes('zone-audit'));
        }
        if (e.name === 'agentfootprint.map.engaged') {
          const p = pay;
          events.push(
            `call ${String(p.iteration)}: ENGAGED by a ${String(p.by)} guess` +
              (p.witness !== undefined ? ` (witness: "${String(p.witness)}")` : '') +
              (p.reengaged === true ? ' — recovered from a park' : ''),
          );
        }
        if (e.name === 'agentfootprint.map.parked') {
          const p = pay;
          events.push(
            `call ${String(p.iteration)}: PARKED after ${String(p.idleCalls)} calls in which ` +
              `none of its tools was used — cursor untouched`,
          );
        }
      },
    })
    .build();
  const answer = String(await agent.run(meta.defaultInput ?? ''));
  return { answer, rode, events };
}

function report(label: string, o: Outcome): void {
  console.log(`\n━━ ${label} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(
    `  zone-audit rode the call, per iteration : [${o.rode.map((r) => (r ? 'YES' : ' — ')).join(', ')}]`,
  );
  for (const line of o.events) console.log(`  ${line}`);
  console.log(`  final answer                             : ${o.answer}`);
}

export async function run(_input: string): Promise<string> {
  const before = await driveTurn(false);
  report('BEFORE — no kernel: the guess rides every call', before);

  const after = await driveTurn(true);
  report('AFTER — .maps({ renewalGrace: 3 })', after);

  console.log(
    '\n  The cursor never moved in either run — parking is the KERNEL’s axis,\n' +
      '  position is the MAP’s. A read_skill pick, a declared route, or the\n' +
      '  map’s own tool re-engages it; see src/maps/README.md for the law.',
  );
  return after.answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
