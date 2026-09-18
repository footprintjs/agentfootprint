/**
 * Integration — the declared ontology (9.106.0, `.ontology(map)`), driven
 * through real agent runs on a scripted provider that keeps every request
 * it was handed.
 *
 * Pattern: Test-as-specification, scenario style.
 * Role:    Pin the RECORD, the WIRE and the REBUILD together —
 *
 *   • `seed` writes the run constant `AgentState.ontology` ONCE per run —
 *     `{ id, version, hash, spec }`, the whole spec — and no stage writes
 *     it again;
 *   • `callLLM · buildCallLLMStage` serves ONE piece with `source:
 *     'ontology'` on EVERY call, composed by `ontology/serve.ts ·
 *     ontologyPiece` from that key, joined after the recovery piece and
 *     before the findings piece, never as an injection;
 *   • `servedView.ts · viewOf` recomposes it byte-equal from the record and
 *     the receipt hashes it as sent (the conformance law);
 *   • the grouped chart's `sf-llm-call` boundary carries the key across, so
 *     BOTH chart shapes serve byte-equal text;
 *   • `agentfootprint.ontology.served` fires once per call with identities
 *     and counts only;
 *   • a `via` tool no registry carries is refused at `.build()`, naming the
 *     ontology and the tool; a skill's tool and `read_skill` pass;
 *   • the unarmed twin: keys(armed) = keys(unarmed) + `ontology`, the same
 *     messages on every call, and not one byte of the system prompt from
 *     the map.
 *
 * The two pure functions have their own unit tests
 * (`test/ontology/{define,serve}.test.ts`); nothing here re-proves a grammar.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  defineTool,
  receiptAt,
  receiptHash,
  servedAt,
  servedViews,
} from '../../../src/index.js';
import { defineInstruction, defineSkill } from '../../../src/injection-engine.js';
import { messageDigestInput } from '../../../src/lib/time-travel/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import type { AgentState } from '../../../src/core/agent/types.js';
import {
  defineOntology,
  ONTOLOGY_INSTRUCTION,
  ontologyPiece,
  type Ontology,
  type OntologySpec,
} from '../../../src/ontology/index.js';
import type { OntologyServedPayload } from '../../../src/events/payloads.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };
type Snapshot = NonNullable<ReturnType<Agent['getSnapshot']>>;
type ReactMode = 'dynamic' | 'dynamic-grouped';
type Build = (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>;

interface Run {
  readonly agent: Agent;
  readonly snapshot: Snapshot;
  readonly wire: readonly LLMRequest[];
  readonly served: readonly OntologyServedPayload[];
}

function scripted(script: readonly Reply[]) {
  const wire: LLMRequest[] = [];
  let i = 0;
  return {
    wire,
    provider: {
      name: 'ontology-mock',
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
const tool = (name: string) =>
  defineTool({
    name,
    description: `the ${name} tool`,
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute: (args: Record<string, unknown>) => `${name} result for ${String(args.q ?? '')}`,
  } as never);

async function run(reactMode: ReactMode, script: readonly Reply[], build: Build): Promise<Run> {
  const { provider, wire } = scripted(script);
  const agent = build(
    Agent.create({ provider: provider as never, model: 'mock', maxIterations: 8, reactMode }),
  ).build();
  const served: OntologyServedPayload[] = [];
  agent.on('agentfootprint.ontology.served', (e) => {
    served.push(e.payload);
  });
  await agent.run({ message: 'which port is down?' });
  return { agent, snapshot: agent.getSnapshot()!, wire, served };
}

const stateOf = (r: Run): Partial<AgentState> => r.snapshot.sharedState as Partial<AgentState>;
const keysOf = (r: Run): string[] => Object.keys(r.snapshot.sharedState ?? {}).sort();
const ontologyPieceOf = (r: Run, epoch: number) =>
  servedAt(r.snapshot, epoch)!.system.pieces.filter((p) => p.source === 'ontology');

/** The parent log's bundles that wrote `key` — a run constant is written by exactly one. */
function writesOf(r: Run, key: string): number {
  let n = 0;
  for (const bundle of r.snapshot.commitLog) {
    const b = bundle as { overwrite?: Record<string, unknown>; updates?: Record<string, unknown> };
    if (key in (b.overwrite ?? {}) || key in (b.updates ?? {})) n += 1;
  }
  return n;
}

// ─── the map every scenario shares ──────────────────────────────────

const SPEC: OntologySpec = {
  id: 'fleet',
  version: '1',
  sources: {
    inventory: {
      meaning: 'the switch inventory export',
      coverage: 'every port on every switch',
      configured: true,
    },
    syslog: { meaning: 'the syslog archive' },
  },
  nodes: {
    port: {
      meaning: 'a physical switch port',
      aliases: ['interface'],
      sources: [{ source: 'inventory', via: ['lookup_port'], coverage: 'all ports' }],
    },
    port_error_rate: { meaning: 'CRC errors per minute on a port', unit: 'errors/min' },
    outage_ticket: { meaning: 'an open incident about a port', sources: [{ source: 'syslog' }] },
  },
  edges: [
    { from: 'port_error_rate', to: 'port', relation: 'measured-on', meaning: 'the port it counts' },
  ],
};
const MAP: Ontology = defineOntology(SPEC);
const PIECE = ontologyPiece(MAP).rawContent;

const SCRIPT: readonly Reply[] = [
  call('c1', 'lookup_port', { q: 'p1' }),
  call('c2', 'lookup_port', { q: 'p2' }),
  answer('p1 is down'),
];

const armed: Build = (a) => a.system('bot').tool(tool('lookup_port')).ontology(MAP);
const unarmed: Build = (a) => a.system('bot').tool(tool('lookup_port'));

// ─── 1. the record ──────────────────────────────────────────────────

describe('the declared ontology — on the record once', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: seed writes { id, version, hash, spec } once, the whole spec, and no stage writes it again`, async () => {
      const r = await run(reactMode, SCRIPT, armed);
      expect(stateOf(r).ontology).toEqual({
        id: 'fleet',
        version: '1',
        hash: MAP.hash,
        spec: {
          id: 'fleet',
          version: '1',
          nodes: SPEC.nodes,
          sources: SPEC.sources,
          edges: SPEC.edges,
        },
      });
      expect(writesOf(r, 'ontology')).toBe(1);
      // A run constant: the seed's bundle carries it, no later one does.
      const first = r.snapshot.commitLog[0] as { overwrite?: Record<string, unknown> };
      expect('ontology' in (first.overwrite ?? {})).toBe(true);
    });
  }

  it('the record survives structuredClone and is the same on a second run of the same agent', async () => {
    const r = await run('dynamic', SCRIPT, armed);
    const record = structuredClone(stateOf(r).ontology);
    expect(record?.hash).toBe(MAP.hash);
    await r.agent.run({ message: 'again' });
    const again = r.agent.getSnapshot()!.sharedState as Partial<AgentState>;
    expect(again.ontology).toEqual(stateOf(r).ontology);
  });
});

// ─── 2. the piece: every call, wire = rebuild, order, never an injection ──

describe('the declared ontology — served on every call', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: one piece with source 'ontology' on every epoch, byte-equal on the wire and in the rebuild`, async () => {
      const r = await run(reactMode, SCRIPT, armed);
      const views = servedViews(r.snapshot);
      expect(views).toHaveLength(3);
      for (const view of views) {
        const pieces = ontologyPieceOf(r, view.epoch);
        expect(pieces, `epoch ${view.epoch}`).toHaveLength(1);
        expect(pieces[0]!.slot).toBe('system-prompt');
        expect(pieces[0]!.text).toBe(PIECE);
        // The wire carried exactly what the rebuild composes.
        const sent = r.wire[view.epoch - 1]!;
        expect(sent.systemPrompt).toBe(view.system.text);
        expect(sent.systemPrompt).toContain(PIECE);
        expect(sent.systemPrompt!.endsWith(PIECE)).toBe(true);
        // The always-on ask is there too, BEFORE the piece, as an injection.
        const ask = view.system.pieces.findIndex((p) => p.text === ONTOLOGY_INSTRUCTION);
        expect(ask).toBeGreaterThanOrEqual(0);
        expect(ask).toBeLessThan(view.system.pieces.length - 1);
      }
    });
  }

  it('the piece is NOT an injection: systemPromptInjections never carries an ontology record, the ask is one', async () => {
    const r = await run('dynamic', SCRIPT, armed);
    const injections = stateOf(r).systemPromptInjections ?? [];
    expect(injections.some((i) => i.source === 'ontology')).toBe(false);
    expect(injections.some((i) => i.rawContent === ONTOLOGY_INSTRUCTION)).toBe(true);
    expect((stateOf(r).activeInjections ?? []).some((i) => i.source === 'ontology')).toBe(false);
  });

  it('joined AFTER the recovery piece and BEFORE the findings piece: injections → recovery → ontology → findings', async () => {
    // A findings ledger with a standing declared on the second call, so the
    // third call serves a findings piece beside the ontology piece.
    const declaring: readonly Reply[] = [
      call('c1', 'lookup_port', { q: 'p1', _findings: { basis: 'exploratory' } }),
      call('c2', 'lookup_port', {
        q: 'p2',
        _findings: {
          basis: 'direct',
          previous: [
            {
              toolCallId: 'c1',
              standing: 'fact',
              assertions: [
                { subject: { kind: 'port', id: 'p1' }, predicate: 'state', value: 'down' },
              ],
            },
          ],
        },
      }),
      answer('p1 is down'),
    ];
    const r = await run('dynamic', declaring, (a) => armed(a).findings());
    const view = servedAt(r.snapshot, 3)!;
    const sources = view.system.pieces.map((p) => p.source);
    const ontology = sources.indexOf('ontology');
    const findings = sources.indexOf('findings');
    expect(ontology).toBeGreaterThan(-1);
    expect(findings).toBe(ontology + 1);
    expect(findings).toBe(sources.length - 1);
    expect(r.wire[2]!.systemPrompt).toBe(view.system.text);
    // Epoch 1: no standing yet, so the ontology piece is last.
    const at1 = servedAt(r.snapshot, 1)!.system.pieces.map((p) => p.source);
    expect(at1[at1.length - 1]).toBe('ontology');
  });

  it('both chart shapes serve byte-equal system text at every epoch (the grouped boundary line)', async () => {
    const flat = await run('dynamic', SCRIPT, armed);
    const grouped = await run('dynamic-grouped', SCRIPT, armed);
    for (const epoch of [1, 2, 3]) {
      expect(servedAt(grouped.snapshot, epoch)!.system.text).toBe(
        servedAt(flat.snapshot, epoch)!.system.text,
      );
      expect(grouped.wire[epoch - 1]!.systemPrompt).toBe(flat.wire[epoch - 1]!.systemPrompt);
    }
  });
});

// ─── 3. the receipt ─────────────────────────────────────────────────

describe('the declared ontology — the receipt', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: every epoch's receipt hashes the system text with the piece, one hash per piece, sources in order`, async () => {
      const r = await run(reactMode, SCRIPT, armed);
      for (const view of servedViews(r.snapshot)) {
        const receipt = receiptAt(r.snapshot, view.epoch)!;
        const hash = (content: string): string => receiptHash(receipt.basis.runId, content);
        const sent = r.wire[view.epoch - 1]!;
        expect(hash(view.system.text), `epoch ${view.epoch}`).toBe(receipt.system.hash);
        expect(hash(sent.systemPrompt ?? '')).toBe(receipt.system.hash);
        expect(receipt.system.pieces.map((p) => p.source)).toEqual(
          view.system.pieces.map((p) => p.source),
        );
        const at = receipt.system.pieces.findIndex((p) => p.source === 'ontology');
        expect(at).toBeGreaterThan(-1);
        expect(receipt.system.pieces[at]!.hash).toBe(hash(PIECE));
        expect(receipt.messages.entries).toHaveLength(view.messages.asSent.length);
        view.messages.asSent.forEach((m, i) => {
          expect(receipt.messages.entries[i]!.hash).toBe(hash(messageDigestInput(m)));
        });
      }
    });
  }

  it('the piece carries no per-call byte: the same system hash on every call whose injections did not move', async () => {
    const r = await run('dynamic', SCRIPT, armed);
    const hashes = servedViews(r.snapshot).map((v) => receiptAt(r.snapshot, v.epoch)!.system.hash);
    expect(new Set(hashes).size).toBe(1);
  });
});

// ─── 4. the event ───────────────────────────────────────────────────

describe('the declared ontology — the event', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: agentfootprint.ontology.served once per call, identities and counts only`, async () => {
      const r = await run(reactMode, SCRIPT, armed);
      expect(r.served).toHaveLength(3);
      r.served.forEach((p, i) => {
        expect(p).toEqual({
          iteration: i + 1,
          id: 'fleet',
          version: '1',
          hash: MAP.hash,
          nodes: 3,
          sources: 2,
          edges: 1,
        });
      });
      const text = JSON.stringify(r.served);
      for (const word of ['switch inventory', 'lookup_port', 'measured-on', 'errors/min']) {
        expect(text).not.toContain(word);
      }
    });
  }

  it('the unarmed twin never fires it', async () => {
    const r = await run('dynamic', SCRIPT, unarmed);
    expect(r.served).toEqual([]);
  });
});

// ─── 5. the registry check at build ─────────────────────────────────

describe('the declared ontology — the registry check at build', () => {
  const withVia = (via: readonly string[]): Ontology =>
    defineOntology({
      ...SPEC,
      nodes: {
        ...SPEC.nodes,
        port: { meaning: 'a port', sources: [{ source: 'inventory', via }] },
      },
    });
  const base = () =>
    Agent.create({ provider: scripted([answer('x')]).provider as never, model: 'mock' }).system(
      'bot',
    );

  it('a tool no registry carries is refused, naming the ontology, the tool, the node and the source', () => {
    expect(() =>
      base()
        .tool(tool('lookup_port'))
        .ontology(withVia(['ghost_tool']))
        .build(),
    ).toThrow(
      /ontology 'fleet' names tool 'ghost_tool' that is not registered \(node 'port', source 'inventory'\)/,
    );
  });

  it("a .tool() name, a skill's tool and the read_skill door pass", () => {
    const skill = defineSkill({
      id: 'ports',
      description: 'ports',
      body: 'PORTS_BODY',
      tools: [tool('skill_lookup')],
    } as never);
    expect(() =>
      base()
        .tool(tool('lookup_port'))
        .skill(skill)
        .ontology(withVia(['lookup_port', 'skill_lookup', 'read_skill']))
        .build(),
    ).not.toThrow();
  });

  it('a node with no `via` names no tool and is never checked', () => {
    expect(() => base().ontology(MAP).build()).toThrow(/names tool 'lookup_port'/);
    expect(() =>
      base()
        .ontology(defineOntology({ ...SPEC, nodes: { port: { meaning: 'a port' } }, edges: [] }))
        .build(),
    ).not.toThrow();
  });
});

// ─── 6. the builder door ────────────────────────────────────────────

describe('the declared ontology — the builder door', () => {
  const base = () =>
    Agent.create({ provider: scripted([answer('x')]).provider as never, model: 'mock' }).system(
      'bot',
    );

  it('refuses a second call, naming itself', () => {
    expect(() => base().ontology(MAP).ontology(MAP)).toThrow(/AgentBuilder\.ontology: already set/);
  });

  it('refuses a bare spec: the definition is where the declaration is validated', () => {
    expect(() => base().ontology(SPEC as never)).toThrow(
      /expected the frozen Ontology `defineOntology\(spec\)` returns/,
    );
    expect(() => base().ontology({ ...MAP } as never)).toThrow(/defineOntology/);
    expect(() => base().ontology(null as never)).toThrow(/AgentBuilder\.ontology/);
  });

  it('the option form goes through the same door', async () => {
    const { provider, wire } = scripted(SCRIPT);
    const agent = Agent.create({ provider: provider as never, model: 'mock', ontology: MAP })
      .system('bot')
      .tool(tool('lookup_port'))
      .build();
    await agent.run({ message: 'go' });
    expect(wire[0]!.systemPrompt!.endsWith(PIECE)).toBe(true);
    expect(wire[0]!.systemPrompt).toContain(ONTOLOGY_INSTRUCTION);
    expect(() =>
      Agent.create({ provider: provider as never, model: 'mock', ontology: MAP }).ontology(MAP),
    ).toThrow(/already set/);
  });

  // ── the ask (9.107.0): a named value, the `answerAsk` grammar ──
  it("ask 'use-the-map' is the default: the same wire as no option at all", async () => {
    const a = await run('dynamic', SCRIPT, armed);
    const b = await run('dynamic', SCRIPT, (x) =>
      x.system('bot').tool(tool('lookup_port')).ontology(MAP, { ask: 'use-the-map' }),
    );
    expect(b.wire.map((w) => w.systemPrompt)).toEqual(a.wire.map((w) => w.systemPrompt));
  });

  it("ask 'none': the map is served as data on every call and NO ask of the library's is registered", async () => {
    const r = await run('dynamic', SCRIPT, (x) =>
      x.system('bot').tool(tool('lookup_port')).ontology(MAP, { ask: 'none' }),
    );
    for (const view of servedViews(r.snapshot)) {
      expect(ontologyPieceOf(r, view.epoch)).toHaveLength(1);
      expect(view.system.pieces.some((p) => p.text === ONTOLOGY_INSTRUCTION)).toBe(false);
    }
    for (const sent of r.wire) {
      expect(sent.systemPrompt!.endsWith(PIECE)).toBe(true);
      expect(sent.systemPrompt).not.toContain('Ontology v');
    }
    const injections = stateOf(r).systemPromptInjections ?? [];
    expect(injections.some((i) => i.rawContent === ONTOLOGY_INSTRUCTION)).toBe(false);
    // The record still carries the map: the ask is the only thing that changed.
    expect(stateOf(r).ontology?.hash).toBe(MAP.hash);
    expect(r.served).toHaveLength(r.wire.length);
  });

  it("ask 'none' leaves room for the application's own instruction through .instruction()", async () => {
    const own = 'Answer with the source that holds the term, in one line.';
    const r = await run('dynamic', SCRIPT, (x) =>
      x
        .system('bot')
        .tool(tool('lookup_port'))
        .ontology(MAP, { ask: 'none' })
        .instruction(defineInstruction({ id: 'own-ask', activeWhen: () => true, prompt: own })),
    );
    for (const sent of r.wire) {
      expect(sent.systemPrompt).toContain(own);
      expect(sent.systemPrompt).not.toContain(ONTOLOGY_INSTRUCTION);
    }
  });

  it('refuses an ask that is not one of the named values, and an option-form ask without a map', () => {
    expect(() => base().ontology(MAP, { ask: 'always' as never })).toThrow(
      /ask must be 'none' or 'use-the-map', got "always"/,
    );
    expect(() => base().ontology(MAP, { ask: true as never })).toThrow(/ask must be/);
    expect(() =>
      Agent.create({
        provider: scripted([answer('x')]).provider as never,
        model: 'mock',
        ontologyAsk: 'none',
      }),
    ).toThrow(/`ontologyAsk` without `ontology`/);
  });

  it("the option form carries the ask too: `ontologyAsk: 'none'` beside `ontology`", async () => {
    const { provider, wire } = scripted(SCRIPT);
    const agent = Agent.create({
      provider: provider as never,
      model: 'mock',
      ontology: MAP,
      ontologyAsk: 'none',
    })
      .system('bot')
      .tool(tool('lookup_port'))
      .build();
    await agent.run({ message: 'go' });
    expect(wire[0]!.systemPrompt!.endsWith(PIECE)).toBe(true);
    expect(wire[0]!.systemPrompt).not.toContain(ONTOLOGY_INSTRUCTION);
  });
});

// ─── 7. the twins ───────────────────────────────────────────────────

describe('the declared ontology — the unarmed twin', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: keys(armed) = keys(unarmed) + ontology; the same messages on every call; the map moves only the system prompt`, async () => {
      const on = await run(reactMode, SCRIPT, armed);
      const off = await run(reactMode, SCRIPT, unarmed);
      expect(keysOf(on)).toEqual([...keysOf(off), 'ontology'].sort());
      expect(keysOf(off)).not.toContain('ontology');
      expect(on.wire).toHaveLength(off.wire.length);
      for (const [i, sent] of off.wire.entries()) {
        expect(JSON.stringify(on.wire[i]!.messages)).toBe(JSON.stringify(sent.messages));
        expect(JSON.stringify(on.wire[i]!.tools)).toBe(JSON.stringify(sent.tools));
        expect(sent.systemPrompt).not.toContain('[AgentFootprint ontology');
        expect(sent.systemPrompt).not.toContain(ONTOLOGY_INSTRUCTION);
        // The armed prompt is the unarmed one plus the ask and the piece.
        expect(on.wire[i]!.systemPrompt!.startsWith(sent.systemPrompt!)).toBe(true);
        expect(on.wire[i]!.systemPrompt).toBe(
          `${sent.systemPrompt}\n\n${ONTOLOGY_INSTRUCTION}\n\n${PIECE}`,
        );
      }
      for (const view of servedViews(off.snapshot)) {
        expect(view.system.pieces.some((p) => p.source === 'ontology')).toBe(false);
        expect(view.system.text).toBe(off.wire[view.epoch - 1]!.systemPrompt);
      }
    });
  }
});
