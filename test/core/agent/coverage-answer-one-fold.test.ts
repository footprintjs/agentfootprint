/**
 * The answer's limits: ONE fold, two forms — and the assumed values travel
 * with a typed answer's limits as data.
 *
 * THE LAW (the review of #27, follow-up 3): the prose block
 * (`composeAnswerWithCoverage`) and the data (`coverageOfAnswer`) are two
 * callers of ONE fold (`coverage/answer.ts` · `foldSections`), so the items
 * the block prints are, in order, the items the data holds — the block only
 * caps what a person reads.
 *
 * THE GAP CLOSED (follow-up 4): under the inputs layer (honesty layer 2) a
 * prose answer's limits carry an "Assumed" block. A TYPED answer's limits
 * (`.outputSchema()` + `.limitsTravelWithTheAnswer()`) carried none — the
 * values a tool's rule assumed never reached `agent.answerCoverage()`. They do
 * now, as `assumed`: the same rows, read by the same function
 * (`arguments/serve.ts` · `assumedLinesFor`) the block prints from.
 *
 * Test types (Convention 3):
 *   - PROPERTY     — 300 generated declaration sets: the block's items equal
 *                    the data's items, section by section, in order;
 *   - UNIT         — `answerCoverageOf`'s identity cases and its detachment;
 *   - INTEGRATION  — a typed agent and its prose twin over one ruled tool: the
 *                    data's `assumed` is the block's lines; a hidden argument
 *                    reads `REDACTED` with `hidden`; a before-tool rewrite
 *                    leaves the row out of both; a run that assumed nothing
 *                    and declared nothing commits no key;
 *   - REGRESSION   — `turn_end.answerCoverage` mirrors the accessor.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  Agent,
  allow,
  COVERAGE_BLOCK_HEADING,
  defineTool,
  type DeclaredCoverage,
  type Tool,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import {
  answerCoverageOf,
  composeAnswerWithCoverage,
  coverageOfAnswer,
} from '../../../src/core/agent/coverage/index.js';
import { SHOWN_ARGS } from '../../../src/core/toolShownArgs.js';

// ─── PROPERTY — one fold, two forms ──────────────────────────────────

/** mulberry32 — a tiny seeded PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WHATS = ['the VM inventory', 'powered-off VMs', 'archived logs', 'host-side multipathing'];
const WHYS = [undefined, 'the API timed out', 'no collector runs there'];

function declarationsOf(seed: number): DeclaredCoverage[] {
  const r = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const items = () =>
    Array.from({ length: Math.floor(r() * 4) }, () => {
      const why = pick(WHYS);
      return { what: pick(WHATS), ...(why !== undefined && { why }) };
    });
  return Array.from({ length: 1 + Math.floor(r() * 5) }, (_, i) => ({
    kind: r() < 0.5 ? 'ledger' : 'absence',
    toolName: 't',
    toolCallId: `c${i}`,
    checked: items(),
    notChecked: items(),
    cannotCover: items(),
  })) as unknown as DeclaredCoverage[];
}

const LABELS = { checked: 'Checked:', notChecked: 'Not checked:', cannotCover: 'Cannot cover:' };

/** The items one section of the block prints, as `- what — why` lines. */
function blockSection(block: string, label: string): string[] {
  const at = block.indexOf(`${label}\n`);
  if (at < 0) return [];
  const lines = block.slice(at + label.length + 1).split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('- ')) break;
    out.push(line.slice(2));
  }
  return out;
}

describe('PROPERTY — the block prints exactly the items the data holds, in order', () => {
  it('over 300 generated declaration sets', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const declared = declarationsOf(seed);
      const data = coverageOfAnswer(declared);
      const block = composeAnswerWithCoverage('A.', declared);
      if (data === undefined) {
        expect(block, `seed ${seed}`).toBe('A.');
        continue;
      }
      expect(block.startsWith(`A.\n\n---\n\n${COVERAGE_BLOCK_HEADING}`), `seed ${seed}`).toBe(true);
      for (const key of ['checked', 'notChecked', 'cannotCover'] as const) {
        const printed = blockSection(block, LABELS[key]);
        const held = data[key].map((i) => `${i.what}${i.why !== undefined ? ` — ${i.why}` : ''}`);
        // The block caps at twelve and says so; the data keeps every item.
        const shown =
          held.length > 12
            ? [...held.slice(0, 12), `… and ${held.length - 12} more (in the run record)`]
            : held;
        expect(printed, `seed ${seed} · ${key}`).toEqual(shown);
      }
    }
  });
});

// ─── UNIT ────────────────────────────────────────────────────────────

describe('UNIT — the typed answer’s limits as one value', () => {
  const folded = { checked: [{ what: 'A' }], notChecked: [], cannotCover: [] };
  const line = { toolName: 'search_logs', argument: 'window', value: '2h', hidden: false };

  it('nothing declared and nothing assumed → no value (the identity case)', () => {
    expect(answerCoverageOf(undefined, [])).toBeUndefined();
  });

  it('declared only → the three lists, no `assumed` key', () => {
    expect(answerCoverageOf(folded, [])).toEqual(folded);
    expect('assumed' in answerCoverageOf(folded, [])!).toBe(false);
  });

  it('assumed only → three empty lists and the assumed values', () => {
    expect(answerCoverageOf(undefined, [line])).toEqual({
      checked: [],
      notChecked: [],
      cannotCover: [],
      assumed: [line],
    });
  });

  it('detached: the value shares no object with its inputs', () => {
    const value = answerCoverageOf(folded, [line])!;
    expect(value.assumed![0]).not.toBe(line);
    expect(value.assumed![0]).toEqual(line);
  });
});

// ─── INTEGRATION ─────────────────────────────────────────────────────

const Verdict = z.object({ errors: z.number() }).strict();

const SCHEMA = {
  type: 'object',
  required: ['service', 'window'],
  properties: {
    service: { type: 'string', description: 'Service name.' },
    window: { type: 'string', enum: ['1h', '2h', '24h'], description: 'Look-back period.' },
  },
} as const;

function searchLogs(): Tool {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: SCHEMA,
    askOrAssume: { window: { assume: '2h' } },
    execute: async () => ({ errors: 0 }),
  });
}

const replies = (answer: string) =>
  mock({
    replies: [
      { toolCalls: [{ id: 'c1', name: 'search_logs', args: { service: 'checkout' } }] },
      { content: answer },
    ] as never,
  });

function typedAgent(
  tool: Tool,
  extra?: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
) {
  const b = Agent.create({ provider: replies('{"errors":0}'), model: 'mock' })
    .tool(tool)
    .outputSchema(Verdict)
    .limitsTravelWithTheAnswer();
  return (extra ? extra(b) : b).build();
}

function proseAgent(
  tool: Tool,
  extra?: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
) {
  const b = Agent.create({ provider: replies('No errors.'), model: 'mock' })
    .tool(tool)
    .limitsTravelWithTheAnswer();
  return (extra ? extra(b) : b).build();
}

describe('INTEGRATION — a typed answer’s limits carry what was assumed', () => {
  it('the data’s `assumed` is the prose twin’s "Assumed" block, line for line', async () => {
    const typed = typedAgent(searchLogs());
    const turnEnds: Record<string, unknown>[] = [];
    typed.on('agentfootprint.agent.turn_end', (e) => {
      turnEnds.push(e.payload as unknown as Record<string, unknown>);
    });
    const verdict = await typed.runTyped({ message: 'errors on checkout?' });
    expect(verdict).toEqual({ errors: 0 }); // still JSON — nothing appended
    const limits = typed.answerCoverage();
    expect(limits).toEqual({
      checked: [],
      notChecked: [],
      cannotCover: [],
      assumed: [{ toolName: 'search_logs', argument: 'window', value: '2h', hidden: false }],
    });
    expect(turnEnds.at(-1)!.answerCoverage).toEqual(limits);

    const prose = proseAgent(searchLogs());
    const answer = (await prose.run({ message: 'errors on checkout?' })) as string;
    const printed = answer.split("Assumed (a tool's rule, not your words):\n")[1]!.split('\n');
    expect(printed).toEqual(
      limits!.assumed!.map((l) => `- ${l.argument} = ${JSON.stringify(l.value)} (${l.toolName})`),
    );
  });

  it('an argument the tool’s view hides reads REDACTED with `hidden` — never the value', async () => {
    // The view rides the tool object itself (the layer's own security test builds it this way).
    const hiding = {
      ...searchLogs(),
      [SHOWN_ARGS]: (args: Record<string, unknown>) =>
        'window' in args ? { ...args, window: 'REDACTED' } : args,
    } as unknown as Tool;
    const typed = typedAgent(hiding);
    await typed.runTyped({ message: 'errors on checkout?' });
    expect(typed.answerCoverage()!.assumed).toEqual([
      { toolName: 'search_logs', argument: 'window', value: 'REDACTED', hidden: true },
    ]);
    expect(JSON.stringify(typed.answerCoverage())).not.toContain('"2h"');
  });

  it('a before-tool rewrite with no declared origin leaves the row out — of the data as of the block', async () => {
    const rewrite = (b: ReturnType<typeof Agent.create>) =>
      b.toolMiddleware({
        name: 'widen',
        onToolCall: (call) =>
          call.toolName === 'search_logs'
            ? allow({ ...call.args, window: '24h' }, 'widened')
            : allow(),
      });
    const typed = typedAgent(searchLogs(), rewrite);
    await typed.runTyped({ message: 'errors on checkout?' });
    expect(typed.answerCoverage()).toBeUndefined(); // nothing declared, the one row superseded
    const prose = proseAgent(searchLogs(), rewrite);
    expect(await prose.run({ message: 'errors on checkout?' })).toBe('No errors.');
  });

  it('no ruled tool: a typed run that declared nothing commits no key', async () => {
    const plain = defineTool({
      name: 'search_logs',
      description: 'Error lines.',
      inputSchema: SCHEMA,
      execute: async () => ({ errors: 0 }),
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'search_logs', args: { service: 'a', window: '1h' } }] },
          { content: '{"errors":0}' },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(plain)
      .outputSchema(Verdict)
      .limitsTravelWithTheAnswer()
      .build();
    await agent.runTyped({ message: 'errors?' });
    expect(agent.answerCoverage()).toBeUndefined();
    expect('answerCoverage' in (agent.getLastSnapshot()!.sharedState as object)).toBe(false);
  });
});
