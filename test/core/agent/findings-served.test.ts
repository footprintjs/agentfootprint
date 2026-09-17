/**
 * Integration — the answer turn SERVED from the findings ledger (9.101.0,
 * step 3 of the findings-ledger program), driven through real agent runs on
 * a scripted provider that keeps every request it was handed.
 *
 * Pattern: Test-as-specification, scenario style.
 * Role:    Pin the WIRE and the REBUILD together —
 *
 *   • `callLLM · buildCallLLMStage` joins the ledger piece
 *     (`findings/serve.ts · findingsLedgerPiece`) AFTER the recovery piece,
 *     into `systemPieces` only, and serves the message list through
 *     `collapseJudged` BEFORE the staged-refs nudge and the receipt mint;
 *   • `servedView.ts · viewOf` recomposes both with the same functions in
 *     the same order, so `system.text` and `messages.asSent` are the bytes
 *     the provider got and the receipt agrees at every epoch;
 *   • the grouped chart's LLM_CALL inputMapper carries `findingsLedger`
 *     across the boundary, so BOTH chart shapes serve byte-equal text;
 *   • `scope.history` never changes — the collapse is wire-only;
 *   • an unarmed agent, and an armed one whose model declared no standing,
 *     serve the bytes they always did (no piece, no ticket).
 *
 * The two pure functions have their own unit tests
 * (`findings/serve.test.ts`); nothing here re-proves a grammar.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  Agent,
  defineTool,
  receiptAt,
  receiptHash,
  servedAt,
  servedViews,
} from '../../../src/index.js';
import { messageDigestInput } from '../../../src/lib/time-travel/index.js';
import type { LLMMessage, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import type { AgentState } from '../../../src/core/agent/types.js';
import { isCollapsedToolResult } from '../../../src/core/agent/findings/serve.js';
import { FINDINGS_INSTRUCTION } from '../../../src/core/agent/findings/reserved.js';
import { toolNameOfMessage } from '../../../src/core/agent/window/toolNames.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };
type Snapshot = NonNullable<ReturnType<Agent['getSnapshot']>>;
type ReactMode = 'dynamic' | 'dynamic-grouped';

interface Run {
  readonly agent: Agent;
  readonly snapshot: Snapshot;
  /** Every request the provider was handed, verbatim, in call order. */
  readonly wire: readonly LLMRequest[];
  readonly findings: Array<Record<string, unknown>>;
}

/** A provider that answers from a script and keeps every request it saw. */
function scripted(script: readonly Reply[]) {
  const wire: LLMRequest[] = [];
  let i = 0;
  return {
    wire,
    provider: {
      name: 'served-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        wire.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
        i += 1;
        return {
          content: reply.content,
          toolCalls: reply.toolCalls ?? [],
          usage: { input: 0, output: 0 },
        };
      },
    },
  };
}

const answer = (content: string): Reply => ({ content });
const call = (id: string, name: string, args: object = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});

const tool = (name: string, extra: object = {}) =>
  defineTool({
    name,
    description: `the ${name} tool`,
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute: (args: Record<string, unknown>) => `${name} result for ${String(args.q ?? '')}`,
    ...extra,
  } as never);

async function run(
  reactMode: ReactMode,
  script: readonly Reply[],
  build: (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
): Promise<Run> {
  const { provider, wire } = scripted(script);
  const agent = build(
    Agent.create({ provider: provider as never, model: 'mock', maxIterations: 8, reactMode }),
  ).build();
  const findings: Array<Record<string, unknown>> = [];
  agent.on('agentfootprint.integrity.context_error', (e) => {
    findings.push(e.payload as unknown as Record<string, unknown>);
  });
  await agent.run({ message: 'which port is down?' });
  return { agent, snapshot: agent.getSnapshot()!, wire, findings };
}

const stateOf = (r: Run): Partial<AgentState> => r.snapshot.sharedState as Partial<AgentState>;
const keysOf = (r: Run): string[] => Object.keys(r.snapshot.sharedState ?? {}).sort();

/** The `role: 'tool'` message answering `id` on a message list. */
const toolMessage = (messages: readonly LLMMessage[], id: string): LLMMessage | undefined =>
  messages.find((m) => m.role === 'tool' && m.toolCallId === id);

const ticketOf = (m: LLMMessage | undefined): unknown =>
  m === undefined ? undefined : (JSON.parse(m.content) as unknown);

const findingsPieceOf = (r: Run, epoch: number) =>
  servedAt(r.snapshot, epoch)!.system.pieces.find((p) => p.source === 'findings');

// ─── the script every scenario shares ───────────────────────────────
//
// Five calls, each declaring the PREVIOUS result's standing, then a text
// answer. At the call of epoch k the ledger holds the standings declared on
// the calls before it (the tool-calls stage files a call's declarations
// before dispatch), so the wire at epoch k serves what was declared up to
// call k-1 — and result k-1 itself is still undeclared.

const FACT = { subject: { kind: 'port', id: 'p1' }, predicate: 'state', value: 'down' };

const DECLARING: readonly Reply[] = [
  call('c1', 'alpha_tool', { q: 'ports', _findings: { basis: 'exploratory' } }),
  call('c2', 'alpha_tool', {
    q: 'p1',
    _findings: {
      basis: 'direct',
      previous: [{ toolCallId: 'c1', standing: 'fact', sought: true, assertions: [FACT] }],
    },
  }),
  call('c3', 'alpha_tool', {
    q: 'p2',
    _findings: { basis: 'direct', previous: [{ toolCallId: 'c2', standing: 'noise' }] },
  }),
  call('c4', 'alpha_tool', {
    q: 'log',
    _findings: {
      basis: 'direct',
      previous: [{ toolCallId: 'c3', standing: 'open', settles: 'the log for p2' }],
    },
  }),
  call('c5', 'alpha_tool', {
    q: 'switch',
    _findings: {
      basis: 'direct',
      previous: [{ toolCallId: 'c4', standing: 'ruled-out', line: 'p2 is not on switch B' }],
    },
  }),
  answer('p1 is down'),
];

/** Epoch → the ids collapsed on the wire under the default mode. */
const COLLAPSED_BY_EPOCH: Record<number, readonly string[]> = {
  1: [],
  2: [],
  3: [],
  4: ['c2'],
  5: ['c2'],
  6: ['c2', 'c4'],
};

const armed = (a: ReturnType<typeof Agent.create>) =>
  a.system('bot').tool(tool('alpha_tool')).findings();
const unarmed = (a: ReturnType<typeof Agent.create>) => a.system('bot').tool(tool('alpha_tool'));

// ─── 1. both chart shapes tell the model the same thing ─────────────

describe('served from the ledger — both chart shapes', () => {
  it('dynamic and dynamic-grouped serve byte-equal system.text and messages.asSent at every epoch (the grouped inputMapper line)', async () => {
    const flat = await run('dynamic', DECLARING, armed);
    const grouped = await run('dynamic-grouped', DECLARING, armed);
    const epochs = servedViews(flat.snapshot).map((v) => v.epoch);
    expect(epochs).toEqual([1, 2, 3, 4, 5, 6]);
    expect(servedViews(grouped.snapshot).map((v) => v.epoch)).toEqual(epochs);
    for (const epoch of epochs) {
      const a = servedAt(flat.snapshot, epoch)!;
      const b = servedAt(grouped.snapshot, epoch)!;
      expect(b.system.text, `epoch ${epoch} system.text`).toBe(a.system.text);
      expect(JSON.stringify(b.messages.asSent), `epoch ${epoch} asSent`).toBe(
        JSON.stringify(a.messages.asSent),
      );
      expect(b.system.pieces.map((p) => p.source)).toEqual(a.system.pieces.map((p) => p.source));
      // …and the wire itself agrees between the shapes, which is the claim
      // the served view makes about it.
      expect(grouped.wire[epoch - 1]!.systemPrompt).toBe(flat.wire[epoch - 1]!.systemPrompt);
      expect(JSON.stringify(grouped.wire[epoch - 1]!.messages)).toBe(
        JSON.stringify(flat.wire[epoch - 1]!.messages),
      );
    }
    // The grouped shape served a piece: the boundary carried the key.
    expect(findingsPieceOf(grouped, 6)).toBeDefined();
  });
});

// ─── 2. the piece: source, order, content ───────────────────────────

describe('served from the ledger — the piece', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: a piece with source 'findings' from the first epoch with a standing, last in the join, after the instruction piece`, async () => {
      const r = await run(reactMode, DECLARING, armed);
      // Epochs 1 and 2: no standing yet (a basis-only ledger serves nothing).
      expect(findingsPieceOf(r, 1)).toBeUndefined();
      expect(findingsPieceOf(r, 2)).toBeUndefined();
      expect(r.wire[1]!.systemPrompt).not.toContain('[AgentFootprint findings ledger');
      for (const epoch of [3, 4, 5, 6]) {
        const view = servedAt(r.snapshot, epoch)!;
        const piece = view.system.pieces[view.system.pieces.length - 1]!;
        expect(piece.source, `epoch ${epoch}`).toBe('findings');
        expect(piece.slot).toBe('system-prompt');
        expect(piece.text.startsWith('[AgentFootprint findings ledger')).toBe(true);
        // No per-call byte: the header is a constant (the cache law, §7).
        expect(piece.text).not.toMatch(/iteration \d/);
        expect(piece.text).toContain('port/p1 · state = down ← tool:c1');
        // The always-on instruction is still there, BEFORE the piece — the
        // ledger piece is joined, never registered as an injection.
        const instruction = view.system.pieces.findIndex((p) => p.text === FINDINGS_INSTRUCTION);
        expect(instruction).toBeGreaterThanOrEqual(0);
        expect(instruction).toBeLessThan(view.system.pieces.length - 1);
        expect(view.system.pieces.filter((p) => p.source === 'findings')).toHaveLength(1);
        // The wire carried it, at the end of the joined system prompt.
        expect(r.wire[epoch - 1]!.systemPrompt!.endsWith(piece.text)).toBe(true);
      }
      // Epoch 4: c1 fact, c2 noise, c3 undeclared — named as such, never open.
      const at4 = findingsPieceOf(r, 4)!.text;
      expect(at4).toContain('noise (declared by the model): 1 result (tool:c2)');
      expect(at4).toContain('undeclared: 1 result, served in full below (tool:c3)');
      // The header quotes every field's MEANING; a bucket appears only when
      // it has lines — no open row yet, so no evidenceRefs / nextSteps bucket.
      expect(at4).not.toContain('evidenceRefs (declared by the model):');
      expect(at4).not.toContain('nextSteps (declared by the model):');
      expect(at4).not.toContain('limitations (declared by the model):');
      // Epoch 6: every bucket the script reaches.
      const at6 = findingsPieceOf(r, 6)!.text;
      expect(at6).toContain('ruled out (alpha_tool, tool:c4): p2 is not on switch B');
      expect(at6).toContain('open (alpha_tool, tool:c3) · settles: the log for p2');
      expect(at6).toContain('the log for p2 (to settle tool:c3)');
      expect(at6).toContain('undeclared: 1 result, served in full below (tool:c5)');
    });
  }

  it('the piece is NOT an injection: systemPromptInjections never carries a findings record', async () => {
    const r = await run('dynamic', DECLARING, armed);
    const injections = stateOf(r).systemPromptInjections ?? [];
    expect(injections.some((i) => i.source === 'findings')).toBe(false);
    expect((stateOf(r).activeInjections ?? []).some((i) => i.source === 'findings')).toBe(false);
  });
});

// ─── 3. the collapse: wire only, history verbatim ───────────────────

describe('served from the ledger — the collapse', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: noise and ruled-out results are tickets on the wire; open and undeclared verbatim; history keeps every result`, async () => {
      const r = await run(reactMode, DECLARING, armed);
      const history = stateOf(r).history as readonly LLMMessage[];
      const rawOf = (id: string): string => toolMessage(history, id)!.content;
      for (const epoch of [1, 2, 3, 4, 5, 6]) {
        const view = servedAt(r.snapshot, epoch)!;
        const sent = r.wire[epoch - 1]!.messages;
        expect(sent.length, `epoch ${epoch}`).toBe(view.messages.asSent.length);
        for (const m of sent.filter((x) => x.role === 'tool')) {
          const id = m.toolCallId!;
          const rebuilt = toolMessage(view.messages.asSent, id)!;
          expect(rebuilt.content, `epoch ${epoch} ${id}`).toBe(m.content);
          expect(rebuilt.toolName).toBe(m.toolName);
          if (COLLAPSED_BY_EPOCH[epoch]!.includes(id)) {
            const ticket = ticketOf(m);
            expect(isCollapsedToolResult(ticket), `epoch ${epoch} ${id}`).toBe(true);
            expect(ticket).toEqual({
              collapsed: true,
              standing: id === 'c2' ? 'noise' : 'ruled-out',
              toolCallId: id,
            });
            expect(m.toolName).toBe('alpha_tool');
            expect(m.content).not.toContain('result for');
          } else {
            expect(m.content, `epoch ${epoch} ${id} verbatim`).toBe(rawOf(id));
          }
        }
      }
      // History: every result verbatim, no ticket anywhere — the window stage
      // is the only history writer and it never ran.
      for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) {
        expect(rawOf(id)).toBe(
          `alpha_tool result for ${
            DECLARING.map((x) => x.toolCalls?.[0]).find((c) => c?.id === id)!.args[
              'q' as keyof object
            ]
          }`,
        );
        expect(() => ticketOf(toolMessage(history, id))).toThrow();
      }
      // The emission is untouched: the assistant turns still carry `_findings`.
      const c2 = history.find((m) => m.role === 'assistant' && m.toolCalls?.[0]?.id === 'c2');
      expect(c2?.toolCalls?.[0]?.args).toHaveProperty('_findings');
    });
  }

  it("'ledger-only' (bench-gated) collapses fact results too, and the rebuild agrees through the run constant", async () => {
    const r = await run('dynamic', DECLARING, (a) =>
      a.system('bot').tool(tool('alpha_tool')).findings({ serve: 'ledger-only' }),
    );
    expect(stateOf(r).findingsServe).toBe('ledger-only');
    for (const epoch of [3, 4, 5, 6]) {
      const sent = toolMessage(r.wire[epoch - 1]!.messages, 'c1')!;
      expect(ticketOf(sent)).toEqual({ collapsed: true, standing: 'fact', toolCallId: 'c1' });
      const rebuilt = toolMessage(servedAt(r.snapshot, epoch)!.messages.asSent, 'c1')!;
      expect(rebuilt.content).toBe(sent.content);
    }
    // …and the default mode leaves the same result verbatim.
    const d = await run('dynamic', DECLARING, armed);
    expect(stateOf(d).findingsServe).toBe('ledger-and-facts');
    expect(toolMessage(d.wire[5]!.messages, 'c1')!.content).toBe('alpha_tool result for ports');
  });

  it('a collapsed result is still NAMED by toolNameOfMessage — the dangling-reference check counts it present', async () => {
    // `callLLM`'s closure check asks `toolNameOfMessage(m, frame)` over the
    // wire; a ticket keeps `toolName` and `toolCallId`, so a judged result
    // that is still on the wire is present, not dangling. Pinned here so the
    // behaviour is documented, not silently different from the raw case.
    const r = await run('dynamic', DECLARING, armed);
    const frame = r.wire[5]!.messages;
    const collapsed = toolMessage(frame, 'c2')!;
    expect(isCollapsedToolResult(ticketOf(collapsed))).toBe(true);
    expect(toolNameOfMessage(collapsed, frame)).toBe('alpha_tool');
    const { toolName: _dropped, ...nameless } = collapsed;
    void _dropped;
    expect(toolNameOfMessage(nameless as LLMMessage, frame)).toBe('alpha_tool');
  });
});

// ─── 4. the receipt agrees with the rebuild AND the wire ────────────

describe('served from the ledger — the receipt', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: every epoch's receipt hashes the piece and the collapsed entries exactly as sent`, async () => {
      const r = await run(reactMode, DECLARING, armed);
      for (const view of servedViews(r.snapshot)) {
        const receipt = receiptAt(r.snapshot, view.epoch)!;
        const hash = (content: string): string => receiptHash(receipt.basis.runId, content);
        const sent = r.wire[view.epoch - 1]!;
        expect(hash(view.system.text), `epoch ${view.epoch} system`).toBe(receipt.system.hash);
        expect(hash(sent.systemPrompt ?? '')).toBe(receipt.system.hash);
        expect(receipt.system.pieces.map((p) => p.source)).toEqual(
          view.system.pieces.map((p) => p.source),
        );
        expect(receipt.messages.entries).toHaveLength(view.messages.asSent.length);
        view.messages.asSent.forEach((m, i) => {
          expect(receipt.messages.entries[i]!.hash, `epoch ${view.epoch} [${i}]`).toBe(
            hash(messageDigestInput(m)),
          );
          expect(receipt.messages.entries[i]!.hash).toBe(
            hash(messageDigestInput(sent.messages[i]!)),
          );
        });
        expect(receipt.messages.requestOnly).toEqual([]);
        expect(view.messages.requestOnly).toEqual([]);
      }
    });
  }
});

// ─── 5. the twins: unarmed, and armed-but-basis-only ────────────────

describe('served from the ledger — nothing served differently without a standing', () => {
  it('the unarmed twin of a declaring model: no piece, no ticket, asSent is history', async () => {
    const r = await run('dynamic', DECLARING, unarmed);
    expect(keysOf(r)).not.toContain('findingsServe');
    expect(keysOf(r)).not.toContain('findingsLedger');
    const history = stateOf(r).history as readonly LLMMessage[];
    for (const view of servedViews(r.snapshot)) {
      expect(view.system.pieces.some((p) => p.source === 'findings')).toBe(false);
      expect(view.system.text).not.toContain('[AgentFootprint findings ledger');
      const sent = r.wire[view.epoch - 1]!.messages;
      for (const m of sent.filter((x) => x.role === 'tool')) {
        expect(m.content).toBe(toolMessage(history, m.toolCallId!)!.content);
        expect(m.content).not.toContain('"collapsed"');
      }
      expect(JSON.stringify(view.messages.asSent)).toBe(JSON.stringify(sent));
    }
  });

  it('armed, basis-only: the model named no standing, so the piece and the tickets are absent and only the run constant is on the record', async () => {
    const BASIS_ONLY: readonly Reply[] = [
      call('c1', 'alpha_tool', { q: 'ports', _findings: { basis: 'exploratory' } }),
      call('c2', 'alpha_tool', { q: 'p1', _findings: { basis: 'direct' } }),
      answer('p1 is down'),
    ];
    const r = await run('dynamic', BASIS_ONLY, armed);
    expect(stateOf(r).findingsServe).toBe('ledger-and-facts');
    expect((stateOf(r).findingsLedger ?? []).every((row) => row.kind === 'basis')).toBe(true);
    expect((stateOf(r).findingsLedger ?? []).length).toBe(2);
    const history = stateOf(r).history as readonly LLMMessage[];
    for (const view of servedViews(r.snapshot)) {
      expect(view.system.pieces.some((p) => p.source === 'findings')).toBe(false);
      const sent = r.wire[view.epoch - 1]!.messages;
      for (const m of sent.filter((x) => x.role === 'tool')) {
        expect(m.content).toBe(toolMessage(history, m.toolCallId!)!.content);
      }
      expect(JSON.stringify(view.messages.asSent)).toBe(JSON.stringify(sent));
    }
  });
});

// ─── 6. the choice seam: the piece is mixed-trust, like the recovery piece ──

describe('served from the ledger — the piece never excuses an argument', () => {
  it('a value that exists only in the ledger piece files an unsupported-argument finding', async () => {
    // c1: the model looks. c2: it declares c1 a FACT whose subject id it
    // invented — nothing on the wire says '4417-ganymede'. c3: it calls the
    // armed tool with that id. At epoch 3 the id is on the wire in exactly
    // one place: the findings piece, quoting the model's own declaration.
    // The choice seam credits the trusted injections, never a request-only
    // piece (the recovery-piece rule), so the finding files.
    const script: readonly Reply[] = [
      call('c1', 'lookup', { q: 'machines', _findings: { basis: 'exploratory' } }),
      call('c2', 'lookup', {
        q: 'again',
        _findings: {
          basis: 'direct',
          previous: [
            {
              toolCallId: 'c1',
              standing: 'fact',
              assertions: [
                {
                  subject: { kind: 'machine', id: '4417-ganymede' },
                  predicate: 'state',
                  value: 'up',
                },
              ],
            },
          ],
        },
      }),
      call('c3', 'backup_status', { machine: '4417-ganymede', _findings: { basis: 'direct' } }),
      answer('done'),
    ];
    const r = await run('dynamic', script, (a) =>
      a
        .system('bot')
        .tool(tool('lookup'))
        .tool(
          defineTool({
            name: 'backup_status',
            description: 'backup status of one machine',
            inputSchema: { type: 'object', properties: { machine: { type: 'string' } } },
            execute: () => 'no backup record found',
            argumentsFrom: ['lookup'],
          } as never),
        )
        .findings(),
    );
    // The piece at epoch 3 is the only non-assistant place the id appears.
    expect(findingsPieceOf(r, 3)!.text).toContain('machine/4417-ganymede');
    const sent = r.wire[2]!;
    for (const m of sent.messages.filter((x) => x.role !== 'assistant')) {
      expect(m.content).not.toContain('4417-ganymede');
    }
    const filed = r.findings.filter((f) => f.kind === 'unsupported-argument');
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({ seam: 'choice', predicate: 'machine' });
    expect(String(filed[0]!.message)).toContain('backup_status');
    expect(String(filed[0]!.message)).toContain('4417-ganymede');
  });
});

// ─── 7. the cache: a re-ask serves the piece byte-equal ──────────────
//
// The piece joins the ONE system block the cache marker covers (`serve.ts` ·
// "The cache"), so it must carry no byte that is not a function of the
// ledger and the wire's tool ids. The first cut anchored the header to the
// iteration, which made an UNCHANGED ledger a system-cache miss on every
// call. The re-ask is the case where nothing moved: an `output-retry` adds a
// library-authored user turn, not a tool result, and files no standing.

describe('served from the ledger — no per-call byte on the piece', () => {
  it('an output-retry re-ask is served the same piece, the same system prompt and the same system hash as the call before it', async () => {
    const parser = {
      parse: (value: unknown) => {
        const v = value as Record<string, unknown>;
        if (typeof v?.down !== 'string') throw new Error('down must be a string');
        return v as { down: string };
      },
    };
    const script: readonly Reply[] = [
      call('c1', 'alpha_tool', { q: 'ports', _findings: { basis: 'exploratory' } }),
      call('c2', 'alpha_tool', {
        q: 'p1',
        _findings: {
          basis: 'direct',
          previous: [{ toolCallId: 'c1', standing: 'fact', sought: true, assertions: [FACT] }],
        },
      }),
      answer(JSON.stringify({ down: 42 })), // epoch 3: the wrong shape → re-asked
      answer(JSON.stringify({ down: 'p1' })), // epoch 4: the re-ask, same ledger, same wire ids
    ];
    const r = await run('dynamic', script, (a) => armed(a).outputSchema(parser, { retries: 1 }));
    expect(servedViews(r.snapshot).map((v) => v.epoch)).toEqual([1, 2, 3, 4]);
    const at3 = findingsPieceOf(r, 3)!;
    const at4 = findingsPieceOf(r, 4)!;
    expect(at4.text).toBe(at3.text);
    expect(at3.text).not.toMatch(/iteration \d/);
    // The whole joined system prompt — the cached block — went out byte-equal…
    expect(r.wire[3]!.systemPrompt).toBe(r.wire[2]!.systemPrompt);
    // …and the record says so: one system hash for both epochs.
    expect(receiptAt(r.snapshot, 4)!.system.hash).toBe(receiptAt(r.snapshot, 3)!.system.hash);
    // The re-ask itself happened (a second answer epoch after a corrective turn).
    expect(r.wire[3]!.messages.length).toBeGreaterThan(r.wire[2]!.messages.length);
  });
});

// ─── 8. the typed surface says what ships ────────────────────────────
//
// `npm run docs:truth` scans docs-next prose, not JSDoc, so the hover text
// on `AgentOptions.findings`, `AgentBuilder.findings` and `Agent`'s field
// could keep calling `serve` inert after the wire shipped — and did, for one
// review round. Then THIS section kept `keepLedgerFacts` "inert" for a round
// after the hold landed in `stages/window.ts · buildWindowStage` (9.102.0),
// because it pinned the waiting sentence instead of the law. It pins the law
// now: both dials are live, no site says "inert" or "until the hold lands",
// and every site names where `keepLedgerFacts` is spent.

describe('served from the ledger — the typed surface says what ships', () => {
  const REPO = resolve(__dirname, '../../..');
  const read = (rel: string): string => readFileSync(resolve(REPO, rel), 'utf8');
  /** The comment block that ends right before `anchor` — the doc the IDE shows. */
  const docBefore = (text: string, anchor: string): string => {
    const at = text.indexOf(anchor);
    expect(at, anchor).toBeGreaterThan(0);
    const open = text.lastIndexOf('/**', at);
    return text.slice(open, at);
  };
  const SITES: ReadonlyArray<readonly [string, string]> = [
    ['src/core/agent/types.ts', '  readonly findings?: {'],
    // Newline-prefixed so `indexOf` cannot land on the nested
    // `findings.keepLedgerFacts` field (four spaces) that precedes it.
    ['src/core/agent/types.ts', '\n  readonly keepLedgerFacts?: number | false;'],
    ['src/core/agent/AgentBuilder.ts', '  findings(options?: NonNullable<'],
    ['src/core/Agent.ts', '  private readonly findingsOptions?:'],
  ];
  it('no doc site calls `serve` or `keepLedgerFacts` inert; every one names where the hold is spent', () => {
    for (const [rel, anchor] of SITES) {
      const doc = docBefore(read(rel), anchor);
      expect(doc, rel).not.toMatch(/inert until step 3|both are inert|WHAT IT DOES NOT DO YET/i);
      expect(doc, rel).not.toMatch(/`serve`[^.]*\binert\b/);
      // 9.102.0: the hold is live — a waiting sentence on any site is a lie.
      expect(doc, rel).not.toMatch(/keepLedgerFacts[^.]*\binert\b/);
      expect(doc, rel).not.toMatch(/until the hold lands|not yet acted on/i);
      expect(doc, rel).toMatch(/keepLedgerFacts[\s\S]*stages\/window\.ts/);
    }
    // The field-level comments on `serve` and the nested `keepLedgerFacts`,
    // the lines the hover shows first.
    const types = read('src/core/agent/types.ts');
    const serveField = docBefore(types, "    readonly serve?: 'ledger-and-facts' | 'ledger-only';");
    expect(serveField).not.toMatch(/\binert\b/);
    expect(serveField).toMatch(/ledger-only/);
    const nestedFactsField = docBefore(types, '    readonly keepLedgerFacts?: number | false;');
    expect(nestedFactsField).not.toMatch(/\binert\b/);
    expect(nestedFactsField).toMatch(/keepLedgerFacts/);
  });
});

// ─── 9. the proposition (9.102.0): what the call set out to test ────

describe("served from the ledger — a ruled-out line quotes the judged call's own proposition", () => {
  // The script above with two calls declaring what they TEST before their
  // result exists: c3 (`open` later) and c4 (`ruled-out` later). The piece
  // quotes each judged call's own proposition after the model's words —
  // `… — tested: <proposition>` — on the open and ruled-out lines only; a
  // fact line stands on its assertions and `predicts` is record-only.
  const TESTING: readonly Reply[] = DECLARING.map((reply) => {
    const tc = reply.toolCalls?.[0];
    if (tc?.id === 'c3') {
      const args = tc.args as { _findings: object };
      return call('c3', 'alpha_tool', {
        ...tc.args,
        _findings: { ...args._findings, proposition: 'p2 has a log entry' },
      });
    }
    if (tc?.id === 'c4') {
      const args = tc.args as { _findings: object };
      return call('c4', 'alpha_tool', {
        ...tc.args,
        _findings: {
          ...args._findings,
          proposition: 'p2 is on switch B',
          predicts: 'the switch inventory lists p2 under B',
        },
      });
    }
    return reply;
  });

  it('the piece at the answer call reads `ruled out (…): <line> — tested: <proposition>`; open the same; facts never', async () => {
    const r = await run('dynamic', TESTING, armed);
    const at6 = findingsPieceOf(r, 6)!.text;
    expect(at6).toContain(
      'ruled out (alpha_tool, tool:c4): p2 is not on switch B — tested: p2 is on switch B',
    );
    expect(at6).toContain(
      'open (alpha_tool, tool:c3) · settles: the log for p2 — tested: p2 has a log entry',
    );
    // A fact line does not repeat it; `predicts` never reaches the piece;
    // the proposition is the JUDGED call's, not the declaring call's (c5
    // declared c4's standing and wrote no proposition of its own).
    expect(at6).toContain('port/p1 · state = down ← tool:c1\n');
    expect(at6).not.toContain('state = down ← tool:c1 — tested');
    expect(at6).not.toContain('switch inventory');
    // The nextSteps proposal is the model's `settles`, unadorned.
    expect(at6).toContain('the log for p2 (to settle tool:c3)\n');
    // The wire carried the same bytes the rebuild composed.
    expect(r.wire[5]!.systemPrompt!.endsWith(at6)).toBe(true);
  });

  it('the record holds both texts on the basis row; the event carries only the flag', async () => {
    const declared: Array<Record<string, unknown>> = [];
    const { provider, wire } = scripted(TESTING);
    const agent = armed(
      Agent.create({ provider: provider as never, model: 'mock', maxIterations: 8 }),
    ).build();
    agent.on('agentfootprint.findings.declared', (e) => {
      declared.push(e.payload as unknown as Record<string, unknown>);
    });
    await agent.run({ message: 'which port is down?' });
    void wire;
    const rows = (agent.getSnapshot()!.sharedState as Partial<AgentState>).findingsLedger!;
    const basis = rows.filter((row) => row.kind === 'basis');
    expect(basis.find((row) => row.toolCallId === 'c3')).toMatchObject({
      proposition: 'p2 has a log entry',
    });
    expect(basis.find((row) => row.toolCallId === 'c3')).not.toHaveProperty('predicts');
    expect(basis.find((row) => row.toolCallId === 'c4')).toMatchObject({
      proposition: 'p2 is on switch B',
      predicts: 'the switch inventory lists p2 under B',
    });
    expect(basis.find((row) => row.toolCallId === 'c1')).not.toHaveProperty('proposition');
    const c4 = declared.find((p) => p.toolCallId === 'c4')!;
    expect(c4.hasProposition).toBe(true);
    expect(JSON.stringify(c4)).not.toContain('switch');
    expect(declared.find((p) => p.toolCallId === 'c1')).not.toHaveProperty('hasProposition');
  });

  it('no proposition declared, no `tested:` anywhere on the piece', async () => {
    const r = await run('dynamic', DECLARING, armed);
    expect(findingsPieceOf(r, 6)!.text).not.toContain('tested:');
  });
});
