/**
 * Integration — the unsettled-by-absence rule meets the batch settlement
 * (both 9.113.0): a call the settlement answered is no witness, and the row
 * carries the suggestion's sentence, never its typed tool.
 *
 * Pattern: Test-as-specification, scenario style, on real agent runs that
 *          pause part-way through a batch and resume, over a scripted
 *          provider that keeps every request it was handed.
 * Role:    Pin where three packets of one release meet —
 *
 *   • A SETTLED SIBLING FILES NOTHING. The resume answers a call the paused
 *     batch never dispatched with the library's fixed sentence
 *     (`stages/toolCalls.ts` · `notDispatchedResult`, marked
 *     `LLMMessage.notDispatched`). It never reached the dispatch door
 *     (`declareCoverage`), so the door filed no coverage row for it and
 *     emitted no `tools.absent` — although the tool, had it run, would have
 *     returned an `absent()` envelope. And it is no result
 *     (`findings/offer.ts` · `isResultMessage`), so a `ruled-out` standing
 *     that names its id anyway is filed `unknownId`, as written, and the rule
 *     files nothing beside it (`findings/unsettled.ts` · `isReadByTheRule`).
 *     The control is the same batch's FIRST call, which ran and returned the
 *     same kind of envelope: its ruling-out gets its row. At both moments
 *     that file standings (a call's `_findings.previous`, the answer's), on
 *     both chart shapes.
 *   • THE ROW CARRIES THE SENTENCE, NOT THE TYPED TOOL. The envelope the
 *     model was served carries `try_instead_tool` beside `try_instead` (the
 *     typed suggestion); the row carries `tryInstead`, the string byte for
 *     byte, and no other part of the suggestion, and the served section
 *     quotes no typed tool. Nothing in this release reads a typed tool off
 *     the row: the section quotes `try_instead`, and the join that would read
 *     the tool (`source-not-consulted`) is not built.
 *
 * Test types (Convention 3): integration (real pause/resume runs) /
 * regression (the settled call's absence from every record the rule reads).
 */

import { describe, expect, it } from 'vitest';

import {
  absent,
  Agent,
  defineTool,
  isInputPause,
  requestInput,
  type FindingsRow,
} from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import type { LLMMessage, LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import { notDispatchedResult } from '../../../../src/core/agent/stages/toolCalls.js';

// ─── the harness ─────────────────────────────────────────────────────

type ReactMode = 'dynamic' | 'dynamic-grouped';
const MODES: readonly ReactMode[] = ['dynamic', 'dynamic-grouped'];

/** The suggestion's sentence — a tool NAME inside prose, on purpose. */
const SENTENCE = 'Look the name up in cluster_inventory; a storage cluster has no host HBAs.';

/** What the HBA lookup returns for any host: its miss, declared, with the suggestion in both forms. */
const missFor = (host: string) =>
  absent({
    what: `HBAs on host ${host}`,
    checked: ['the HBA table of every collected hypervisor host'],
    notChecked: [
      {
        what: `whether ${host} is a hypervisor host at all`,
        why: 'this lookup reads HBA rows, never the host inventory',
      },
    ],
    tryInstead: SENTENCE,
    tryInsteadTool: { tool: 'cluster_inventory', why: 'it lists what each collected name is' },
  });

/** The HBA lookup — every host it is really called for lands on `ran`. */
const hostHbas = (ran: string[]) =>
  defineTool({
    name: 'host_hbas',
    description: 'the HBAs of one hypervisor host',
    inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
    execute: (args: { host?: unknown }) => {
      ran.push(String(args.host));
      return missFor(String(args.host));
    },
  } as never);

/** The call that pauses the batch: it asks the person for a value. */
const collect = defineTool({
  name: 'collect',
  description: 'ask the person for the year',
  inputSchema: { type: 'object', properties: {} },
  execute: () =>
    requestInput({
      id: 'year',
      question: 'Which year?',
      fields: [{ id: 'year', type: 'number', required: true }],
    }),
});

const RULED_OUT = (toolCallId: string) => ({
  toolCallId,
  standing: 'ruled-out',
  line: 'the HBA path is not what is slow',
});

/** c1 runs and returns an absence, c2 pauses, c3 — the same lookup — is settled on resume. */
const BATCH: Partial<LLMResponse> = {
  toolCalls: [
    {
      id: 'c1',
      name: 'host_hbas',
      args: { host: 'nas-cluster-06', _findings: { basis: 'direct' } },
    },
    { id: 'c2', name: 'collect', args: { _findings: { basis: 'direct' } } },
    {
      id: 'c3',
      name: 'host_hbas',
      args: { host: 'nas-cluster-07', _findings: { basis: 'direct' } },
    },
  ],
};

/** At DISPATCH: the call after the resume rules out the call that ran AND the settled one. */
const AT_DISPATCH: readonly Partial<LLMResponse>[] = [
  BATCH,
  {
    toolCalls: [
      {
        id: 'd1',
        name: 'host_hbas',
        args: {
          host: 'nas-cluster-08',
          _findings: { basis: 'direct', previous: [RULED_OUT('c1'), RULED_OUT('c3')] },
        },
      },
    ],
  },
  { content: 'done' },
];

/** At the ANSWER: the JSON answer after the resume rules out both. */
const AT_ANSWER: readonly Partial<LLMResponse>[] = [
  BATCH,
  {
    content: JSON.stringify({
      text: 'the HBA path is not what is slow',
      _findings: { previous: [RULED_OUT('c1'), RULED_OUT('c3')] },
    }),
  },
];

interface SettledRun {
  readonly requests: readonly LLMRequest[];
  /** The hosts the lookup really ran for, in order. */
  readonly ran: readonly string[];
  /** The `toolCallId` of every `agentfootprint.tools.absent` the door emitted, on both legs. */
  readonly absentIds: readonly unknown[];
  readonly history: readonly LLMMessage[];
  /** What the dispatch door recorded — its one answer to "was it an absence?". */
  readonly doorIds: readonly unknown[];
  readonly ledger: readonly FindingsRow[];
}

async function settledRun(
  reactMode: ReactMode,
  script: readonly Partial<LLMResponse>[],
): Promise<SettledRun> {
  const requests: LLMRequest[] = [];
  const ran: string[] = [];
  const inner = mock({ replies: [...script] });
  const provider = {
    name: inner.name,
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
      return inner.complete(req);
    },
  };
  let builder = Agent.create({ provider, model: 'mock', maxIterations: 8, reactMode })
    .tools([hostHbas(ran), collect])
    .findings();
  if (script === AT_ANSWER) {
    builder = builder.outputSchema(
      { parse: (value: unknown) => value as { text: string } } as never,
      { retries: 0 },
    );
  }
  const agent = builder.build();
  const absentIds: unknown[] = [];
  agent.on('agentfootprint.tools.absent', (e) => absentIds.push(e.payload.toolCallId));
  const paused = await agent.run({ message: 'is nas-cluster-06 slow?' });
  if (!isInputPause(paused)) throw new Error('expected an input pause');
  await agent.resume(paused.checkpoint, {
    requestId: paused.awaitingInput.requestId,
    values: { year: 2026 },
  });
  const state = (agent.getSnapshot()?.sharedState ?? {}) as {
    history?: readonly LLMMessage[];
    coverageDeclared?: readonly { toolCallId?: unknown }[];
  };
  return {
    requests,
    ran,
    absentIds,
    history: state.history ?? [],
    doorIds: (state.coverageDeclared ?? []).map((row) => row.toolCallId),
    ledger: (agent.findings() ?? []) as readonly FindingsRow[],
  };
}

const unsettledIds = (ledger: readonly FindingsRow[]): readonly string[] =>
  ledger.flatMap((row) => (row.kind === 'unsettled-by-absence' ? [row.toolCallId] : []));

/** The ledger's standing row for one id, and the row right after it. */
const standingAndNext = (ledger: readonly FindingsRow[], toolCallId: string) => {
  const at = ledger.findIndex((row) => row.kind === 'standing' && row.toolCallId === toolCallId);
  return { standing: ledger[at], next: ledger[at + 1] };
};

// ─── 1. a settled sibling files nothing ──────────────────────────────

describe('unsettled by absence × batch settlement — a settled sibling is no witness', () => {
  for (const [moment, script] of [
    ['a call', AT_DISPATCH],
    ['the answer', AT_ANSWER],
  ] as const) {
    it.each(MODES)(
      `%s, ruled out on ${moment}: no coverage row, no tools.absent and no row for the settled call — the call that ran gets its row`,
      async (mode) => {
        const r = await settledRun(mode, script);

        // The settled call never ran: its lookup was never called.
        expect(r.ran).not.toContain('nas-cluster-07');
        expect(r.ran[0]).toBe('nas-cluster-06');
        // Its message is the settlement: the fixed sentence, marked.
        const settled = r.history.find((m) => m.role === 'tool' && m.toolCallId === 'c3');
        expect(settled?.content).toBe(
          notDispatchedResult('host_hbas', { toolName: 'collect', toolCallId: 'c2' }),
        );
        expect(settled?.notDispatched).toEqual({
          pausedCall: { toolCallId: 'c2', toolName: 'collect' },
        });

        // The dispatch door: a coverage row and a `tools.absent` for the call
        // that ran, none for the settled one.
        expect(r.doorIds).toContain('c1');
        expect(r.doorIds).not.toContain('c3');
        expect(r.absentIds).toContain('c1');
        expect(r.absentIds).not.toContain('c3');

        // The model's word on the settled id is filed as written — an id the
        // run could not identify — and nothing is filed beside it.
        const c3 = standingAndNext(r.ledger, 'c3');
        expect(c3.standing).toMatchObject({ standing: 'ruled-out', unknownId: true });
        expect(c3.next?.kind).not.toBe('unsettled-by-absence');
        // The control: the call that ran is resolved, and its row sits right after it.
        const c1 = standingAndNext(r.ledger, 'c1');
        expect(c1.standing).toMatchObject({ standing: 'ruled-out', toolName: 'host_hbas' });
        expect(c1.next).toMatchObject({ kind: 'unsettled-by-absence', toolCallId: 'c1' });
        expect(unsettledIds(r.ledger)).toEqual(['c1']);
      },
    );
  }
});

// ─── 2. the row carries the sentence, never the typed tool ───────────

describe('unsettled by absence × typed suggestion — the row carries `try_instead`, not `try_instead_tool`', () => {
  it.each(MODES)(
    '%s: the served envelope carried both; the row and the section carry the sentence alone',
    async (mode) => {
      const r = await settledRun(mode, AT_DISPATCH);

      // The model WAS served the typed tool, inside c1's envelope.
      const served = r.requests[1]!.messages.find(
        (m) => m.role === 'tool' && m.toolCallId === 'c1',
      );
      expect(served?.content).toContain(
        '"try_instead_tool":{"tool":"cluster_inventory","why":"it lists what each collected name is"}',
      );

      // The row: the envelope's words the rule carries, and nothing else.
      const { next } = standingAndNext(r.ledger, 'c1');
      expect(next).toEqual({
        kind: 'unsettled-by-absence',
        toolCallId: 'c1',
        notChecked: [
          {
            what: 'whether nas-cluster-06 is a hypervisor host at all',
            why: 'this lookup reads HBA rows, never the host inventory',
          },
        ],
        tryInstead: SENTENCE,
        iteration: expect.any(Number),
      });

      // The section on the next call quotes the sentence and no typed tool.
      const system = r.requests[2]!.systemPrompt ?? '';
      const section = system.slice(system.indexOf('unsettled by absence (read off the record):'));
      expect(section.split('\n\n')[0]!.split('\n')).toEqual([
        'unsettled by absence (read off the record):',
        'ruled out (host_hbas, tool:c1) on an absence',
        'tool:c1 not_checked: whether nas-cluster-06 is a hypervisor host at all — this lookup reads HBA rows, never the host inventory',
        `tool:c1 try_instead: ${SENTENCE}`,
      ]);
      expect(system).not.toContain('try_instead_tool');
    },
  );
});
