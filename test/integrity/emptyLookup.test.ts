/**
 * empty-lookup (9.77.0) — the run itself produced the identifier, and the
 * lookup for it came back empty.
 *
 * THE FIELD FAILURE this is built from: a triage agent's reverse-lookup tool
 * filtered a column before a pivot, so the column did not exist yet and EVERY
 * reverse lookup returned an empty result — for every identifier, always. The
 * tool then answered successfully with an empty list, and the agent reported
 * in a table, with confidence, that the device was not logged in to any port
 * on the collected switches, advising a check of the physical cabling. The
 * device was logged in the whole time. Nothing in the framework noticed,
 * because an empty result from a broken filter is byte-identical to an empty
 * result from a genuine absence.
 *
 * The laws under test:
 *  (a) THE JOIN — a finding needs BOTH halves: the value came out of a
 *      DECLARED producer's result in this run, and the lookup came back
 *      empty. Either half alone is silence;
 *  (b) THE CEILING — the same advisory is filed for a legitimately empty
 *      answer, because nothing here can tell the two apart, and the ceiling
 *      sentence rides the record verbatim;
 *  (c) WHAT IS NOT JUDGED — a bespoke result shape files a `not-applicable`
 *      ROW and no finding. The row is the point;
 *  (d) DEFAULT OFF — without `noticeEmptyLookups` the run is byte-identical,
 *      save the registered not-applicable row the family's law demands;
 *  (e) THE CANARY — dev posture proves the pure function still fires.
 *
 * NEUTRALIZE-PROOFS, both halves of the join, stated so a future edit that
 * guts one of them goes red here:
 *   • THE CORPUS JOIN — delete the producer's result from the corpus and
 *     'the value was never grounded' goes silent (`checked-pass`);
 *   • THE EMPTY DETECTION — hand the same call a one-row rowset and the
 *     finding disappears.
 *
 * Test types (Convention 3): unit (the pure join + the readings) /
 * functional (the field case through the real loop) / contract (the
 * disposition rows, the advisory flag, the ceiling on the record) /
 * negative (bespoke shapes, ungrounded values, sub-fence values) /
 * zero-delta (the dial absent).
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_LOOKUP_CEILING,
  emptyLookupOf,
  readLookupResult,
  type EmptyLookupCall,
  type ProducedResult,
} from '../../src/integrity/empty-lookup/check.js';
import { beginIntegrityRun } from '../../src/integrity/disposition/lifecycle.js';
import { Agent, absent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { CheckReport } from '../../src/integrity/disposition/types.js';
import type { ContextError } from '../../src/integrity/finding/types.js';

// The anonymized field case, as fixture vocabulary. A storage-fabric agent
// asks an inventory tool which devices exist, then asks a reverse-lookup tool
// which port each one is logged in to.
const DEVICE = '20:00:00:25:b5:aa:00:1f';
const INVENTORY_RESULT = `devices: ${DEVICE} (host-a), 20:00:00:25:b5:aa:00:2c (host-b)`;

const lookup = (
  args: Record<string, unknown>,
  reading: EmptyLookupCall['reading'],
): EmptyLookupCall => ({
  toolName: 'port_for_device',
  toolCallId: 'call-2',
  args,
  argumentsFrom: ['fabric_inventory'],
  reading,
});

const served: readonly ProducedResult[] = [
  { toolName: 'fabric_inventory', text: INVENTORY_RESULT },
];

// ---------------------------------------------------------------------------
// The readings, on their own
// ---------------------------------------------------------------------------

describe('unit: what the library can honestly READ of a result', () => {
  it('a rowset is COUNTED, never interpreted — zero rows is empty, one row is not', () => {
    expect(readLookupResult([], false)).toEqual({ shape: 'rowset', empty: true, rows: 0 });
    expect(readLookupResult([{ port: 'fc1/3' }], false)).toEqual({
      shape: 'rowset',
      empty: false,
      rows: 1,
    });
  });

  it('a declared absence is empty by the author’s own word', () => {
    expect(readLookupResult({ anything: true }, true)).toEqual({ shape: 'absence', empty: true });
  });

  it('every OTHER shape is unreadable — the library declines rather than guesses', () => {
    // A sentence, a bespoke rows-wrapper, a null, an object, a claim ticket.
    // None of these can be counted, and guessing is how a checker starts
    // lying.
    for (const bespoke of [
      'no logins found for that device',
      { rows: [] },
      { results: [], count: 0 },
      null,
      undefined,
      0,
      '',
      { placed: true, ref: 'artifact:1', reason: 'stored' },
    ]) {
      expect(readLookupResult(bespoke, false)).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// The join, on its own
// ---------------------------------------------------------------------------

describe('unit: the join — the run produced it, and the lookup found nothing', () => {
  it('the field case: one advisory naming BOTH tools, the value and the call id', () => {
    const { findings, disposition } = emptyLookupOf(
      lookup({ wwpn: DEVICE }, readLookupResult([], false)),
      served,
      2,
    );
    expect(disposition).toBe('checked-fail');
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.kind).toBe('empty-lookup');
    expect(f.seam).toBe('write');
    expect(f.advisory).toBe(true);
    expect(f.predicate).toBe('wwpn');
    expect(f.subjects).toEqual([
      { kind: 'tool', id: 'port_for_device' },
      { kind: 'tool', id: 'fabric_inventory' },
    ]);
    expect(f.message).toContain('port_for_device');
    expect(f.message).toContain('fabric_inventory');
    expect(f.message).toContain(DEVICE);
    expect(f.message).toContain('call-2');
    // Detection only, said out loud in the sentence itself.
    expect(f.message).toContain('Nothing here blocked the call');
  });

  it('THE CEILING rides the message verbatim — one owner, quoted, never re-worded', () => {
    const { findings } = emptyLookupOf(
      lookup({ wwpn: DEVICE }, readLookupResult([], false)),
      served,
      2,
    );
    expect(findings[0]!.message).toContain(EMPTY_LOOKUP_CEILING);
    // And the sentence itself says the two things that bound this check.
    expect(EMPTY_LOOKUP_CEILING).toContain('can be perfectly true');
    expect(EMPTY_LOOKUP_CEILING).toContain('never a verdict');
  });

  it('the witnesses carry all three facts: the argument, the ground, the emptiness', () => {
    const { findings } = emptyLookupOf(
      lookup({ wwpn: DEVICE }, readLookupResult([], false)),
      served,
      7,
    );
    const witnesses = findings[0]!.witnesses;
    expect(witnesses).toHaveLength(3);
    expect(witnesses[0]).toMatchObject({ subject: { id: 'port_for_device' }, value: DEVICE });
    expect(witnesses[1]).toMatchObject({ subject: { id: 'fabric_inventory' } });
    expect(String(witnesses[2]!.value)).toContain('found nothing');
    for (const w of witnesses) expect(w.epoch).toBe(7);
  });

  it('NEUTRALIZE-PROOF, the corpus join: no producer result carrying the value → checked-pass', () => {
    // The producer RAN, and served something — it just never served this
    // value. That is a real comparison that found no join, so it is a pass,
    // not silence.
    const { findings, disposition } = emptyLookupOf(
      lookup({ wwpn: DEVICE }, readLookupResult([], false)),
      [{ toolName: 'fabric_inventory', text: 'devices: 20:00:00:25:b5:aa:00:2c (host-b)' }],
      2,
    );
    expect(findings).toEqual([]);
    expect(disposition).toBe('checked-pass');
  });

  it('NEUTRALIZE-PROOF, the empty detection: the same grounded value with ONE row → checked-pass', () => {
    const { findings, disposition } = emptyLookupOf(
      lookup({ wwpn: DEVICE }, readLookupResult([{ port: 'fc1/3' }], false)),
      served,
      2,
    );
    expect(findings).toEqual([]);
    expect(disposition).toBe('checked-pass');
  });

  it('only DECLARED producers ground anything — a result from an undeclared tool is not the ground', () => {
    const { findings, disposition } = emptyLookupOf(
      lookup({ wwpn: DEVICE }, readLookupResult([], false)),
      [{ toolName: 'some_other_tool', text: INVENTORY_RESULT }],
      2,
    );
    expect(findings).toEqual([]);
    // The declared ground served nothing this run, so there was nothing to
    // join against — incomparable, which is what `unreachable` counts.
    expect(disposition).toBe('unreachable');
  });

  it('a bespoke result shape is NOT-APPLICABLE and files nothing — the library refuses to judge it', () => {
    const { findings, disposition } = emptyLookupOf(
      lookup({ wwpn: DEVICE }, readLookupResult('no logins found', false)),
      served,
      2,
    );
    expect(findings).toEqual([]);
    expect(disposition).toBe('not-applicable');
  });

  it('a declared absence is judged exactly like a zero-row rowset, and says which it was', () => {
    const { findings, disposition } = emptyLookupOf(
      lookup({ wwpn: DEVICE }, readLookupResult({ af_absent: true }, true)),
      served,
      2,
    );
    expect(disposition).toBe('checked-fail');
    expect(findings[0]!.message).toContain('a declared absence');
  });

  it('the sub-four-character fence holds — short values are never checked', () => {
    const { findings, disposition } = emptyLookupOf(
      lookup({ id: 'a1' }, readLookupResult([], false)),
      [{ toolName: 'fabric_inventory', text: 'ids: a1, b2' }],
      2,
    );
    expect(findings).toEqual([]);
    expect(disposition).toBe('checked-pass');
  });

  it('non-strings are never checked — a number argument is not identifier-shaped', () => {
    const { findings } = emptyLookupOf(
      lookup({ port: 4471 }, readLookupResult([], false)),
      [{ toolName: 'fabric_inventory', text: 'ports: 4471' }],
      2,
    );
    expect(findings).toEqual([]);
  });

  it('two grounded arguments of one call are two notices — the dot-path is the discriminator', () => {
    const { findings } = emptyLookupOf(
      {
        ...lookup({ wwpn: DEVICE, fabric: 'fabric-alpha' }, readLookupResult([], false)),
      },
      [{ toolName: 'fabric_inventory', text: `${INVENTORY_RESULT} on fabric-alpha` }],
      2,
    );
    expect(findings.map((f) => f.predicate).sort()).toEqual(['fabric', 'wwpn']);
  });

  it('nested arguments carry their dot-path, exactly as the choice seam spells it', () => {
    const { findings } = emptyLookupOf(
      lookup({ filter: { devices: [DEVICE] } }, readLookupResult([], false)),
      served,
      2,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.predicate).toBe('filter.devices.0');
  });
});

// ---------------------------------------------------------------------------
// The canary
// ---------------------------------------------------------------------------

describe('contract: the dev-posture canary', () => {
  it('mints AND catches its own synthetic empty lookup', () => {
    const ledger = beginIntegrityRun(
      { wire: true, composeInvariant: false, dangling: true, emptyLookup: true },
      'dev',
    );
    const row = ledger.report().find((r) => r.check === 'empty-lookup')!;
    expect(row.seam).toBe('write');
    expect(row.synthetic).toBe(1);
    // Real counts untouched by canary material.
    expect(row.findings).toBe(0);
    expect(row.checked).toBe(0);
    // Theorem (ii): a check that could not catch its own canary is dead.
    expect(() => ledger.assertAlive({ workExisted: false })).not.toThrow();
  });

  it('an UNARMED empty-lookup is still a registered row, and still proves itself', () => {
    const ledger = beginIntegrityRun(
      { wire: true, composeInvariant: false, dangling: true },
      'dev',
    );
    const row = ledger.report().find((r) => r.check === 'empty-lookup')!;
    expect(row).toMatchObject({ seam: 'write', notApplicable: 1, checked: 0, findings: 0 });
    expect(row.synthetic).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Through the real loop
// ---------------------------------------------------------------------------

const inventory = () =>
  defineTool({
    name: 'fabric_inventory',
    description: 'List the devices this fabric knows about, by their real ids.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => INVENTORY_RESULT,
  });

/** The reverse lookup, in each shape the field case can take. */
const portLookup = (execute: (args: { wwpn: string }) => unknown) =>
  defineTool({
    name: 'port_for_device',
    description: 'Which port a device is logged in to.',
    inputSchema: {
      type: 'object',
      properties: { wwpn: { type: 'string' } },
      required: ['wwpn'],
    },
    argumentsFrom: ['fabric_inventory'],
    execute: execute as (args: Record<string, unknown>) => unknown,
  });

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const answered = {
  content: 'The device is not logged in to any port on the collected switches.',
  toolCalls: [],
  stopReason: 'stop' as const,
};

/** The exact scripted turn the field failure took. */
const script = () => [
  call('c1', 'fabric_inventory'),
  call('c2', 'port_for_device', { wwpn: DEVICE }),
  answered,
];

interface RunOut {
  readonly findings: ContextError[];
  readonly rows: CheckReport[];
  readonly answer: string;
}

async function runWith(
  tool: ReturnType<typeof portLookup>,
  options: { notice?: boolean; posture?: 'observe' | 'dev' } = {},
): Promise<RunOut> {
  const findings: ContextError[] = [];
  let rows: CheckReport[] = [];
  const agent = Agent.create({
    provider: mock({ replies: script() }),
    model: 'mock',
    maxIterations: 6,
    ...(options.notice === true && { noticeEmptyLookups: true }),
    ...(options.posture !== undefined && { integrityPosture: options.posture }),
  })
    .system('You are a fabric triage assistant.')
    .tool(inventory())
    .tool(tool)
    .build();
  agent.on('agentfootprint.integrity.context_error', (e) => {
    findings.push(e.payload as unknown as ContextError);
  });
  agent.on('agentfootprint.integrity.disposition', (e) => {
    rows = e.payload.rows as CheckReport[];
  });
  const answer = await agent.run('which port is the first device on?');
  return { findings, rows, answer: String(answer) };
}

const emptyRow = (rows: CheckReport[]): CheckReport =>
  rows.find((r) => r.check === 'empty-lookup' && r.seam === 'write')!;

describe('functional: the field case, through the real loop', () => {
  it('THE FIELD CASE — a grounded id, an empty rowset, one advisory naming both tools and the value', async () => {
    const out = await runWith(
      portLookup(() => []),
      { notice: true },
    );
    const mine = out.findings.filter((f) => f.kind === 'empty-lookup');
    expect(mine).toHaveLength(1);
    const f = mine[0]!;
    expect(f.seam).toBe('write');
    expect(f.advisory).toBe(true);
    expect(f.message).toContain('port_for_device');
    expect(f.message).toContain('fabric_inventory');
    expect(f.message).toContain(DEVICE);
    // The agent's answer is UNTOUCHED — this notices, it never intervenes.
    expect(out.answer).toContain('not logged in');
    // And the ledger counts the encounter as a real check that fired. The
    // two not-applicable notes beside it are the honest ones: the turn that
    // called the PRODUCER and the turn that answered both made no armed call,
    // and a stage every iteration passes through says so rather than leaving
    // an armed row untouched.
    expect(emptyRow(out.rows)).toMatchObject({
      checked: 1,
      findings: 1,
      notApplicable: 2,
      unreachable: 0,
    });
    expect(emptyRow(out.rows).lastFiredAt).toBeDefined();
  });

  it('A LEGITIMATELY EMPTY ANSWER files the SAME advisory — the check does not pretend to know which', async () => {
    // Same script, same grounded id, and a tool that is working perfectly:
    // it declares an absence, naming what it searched. The device genuinely
    // has no logins right now. The finding is identical in kind, seam and
    // advisory-ness, and the ceiling on the record is what says so.
    const out = await runWith(
      portLookup(({ wwpn }) =>
        absent({
          what: `port logins for ${wwpn}`,
          checked: ['the live name-server database on every collected switch'],
        }),
      ),
      { notice: true },
    );
    const mine = out.findings.filter((f) => f.kind === 'empty-lookup');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.advisory).toBe(true);
    // THE CEILING, in the record, verbatim: this is a place to look, not a
    // verdict — and it is the only thing distinguishing this run's finding
    // from the broken-filter run's finding, because nothing else can.
    expect(mine[0]!.message).toContain(EMPTY_LOOKUP_CEILING);
    expect(mine[0]!.message).toContain('a declared absence');
  });

  it('A BESPOKE RESULT SHAPE files a not-applicable ROW and no finding', async () => {
    // The tool answers with a wrapper the library cannot count. It may well
    // be empty; nothing here can see that, and a check that guessed would be
    // the decoration this family exists to prevent.
    const out = await runWith(
      portLookup(() => ({ rows: [], searched: 'everything' })),
      { notice: true },
    );
    expect(out.findings.filter((f) => f.kind === 'empty-lookup')).toEqual([]);
    expect(emptyRow(out.rows)).toMatchObject({ checked: 0, findings: 0 });
    // The row is the point: the encounter happened and was declined, twice —
    // once for the un-armed `fabric_inventory` turn, once for the armed call
    // whose shape could not be read.
    expect(emptyRow(out.rows).notApplicable).toBeGreaterThanOrEqual(1);
  });

  it('AN UNGROUNDED IDENTIFIER files nothing — this check is only about ids the run produced', async () => {
    const findings: ContextError[] = [];
    let rows: CheckReport[] = [];
    const agent = Agent.create({
      provider: mock({
        replies: [
          call('c1', 'fabric_inventory'),
          // A device the inventory never listed: the model invented it. That
          // is the CHOICE seam's business, and this check stays out of it.
          call('c2', 'port_for_device', { wwpn: '20:00:00:25:b5:ff:ff:ff' }),
          answered,
        ],
      }),
      model: 'mock',
      maxIterations: 6,
      noticeEmptyLookups: true,
    })
      .system('s')
      .tool(inventory())
      .tool(portLookup(() => []))
      .build();
    agent.on('agentfootprint.integrity.context_error', (e) => {
      findings.push(e.payload as unknown as ContextError);
    });
    agent.on('agentfootprint.integrity.disposition', (e) => {
      rows = e.payload.rows as CheckReport[];
    });
    await agent.run('go');
    expect(findings.filter((f) => f.kind === 'empty-lookup')).toEqual([]);
    // The check RAN and passed — a real comparison that found no join.
    expect(emptyRow(rows)).toMatchObject({ checked: 1, findings: 0 });
    // The choice seam, meanwhile, has plenty to say about it. That division
    // is the point: one seam owns fabrication, this one owns the empty answer.
    expect(findings.some((f) => f.kind === 'unsupported-argument')).toBe(true);
  });
});

describe('zero-delta: the dial absent', () => {
  it('the SAME run without the dial files no finding at all — the dial is load-bearing', async () => {
    const on = await runWith(
      portLookup(() => []),
      { notice: true },
    );
    const off = await runWith(portLookup(() => []));
    expect(on.findings.filter((f) => f.kind === 'empty-lookup')).toHaveLength(1);
    expect(off.findings.filter((f) => f.kind === 'empty-lookup')).toEqual([]);
    // Everything the model saw and produced is identical.
    expect(off.answer).toBe(on.answer);
  });

  it('the dial off is a registered NOT-APPLICABLE row, never a missing one', async () => {
    // The family's law, and the one visible difference from the release
    // before this check existed: registered-but-unarmed is a ROW. A silent
    // absence is exactly what let two shipped checks decay into decoration.
    const off = await runWith(portLookup(() => []));
    expect(emptyRow(off.rows)).toMatchObject({
      check: 'empty-lookup',
      seam: 'write',
      checked: 0,
      findings: 0,
      notApplicable: 1,
      unreachable: 0,
    });
  });

  it('the dial on with NO tool declaring argumentsFrom stays unarmed — two halves, both required', async () => {
    let rows: CheckReport[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [call('c1', 'fabric_inventory'), answered] }),
      model: 'mock',
      maxIterations: 4,
      noticeEmptyLookups: true,
    })
      .system('s')
      .tool(inventory())
      .build();
    agent.on('agentfootprint.integrity.disposition', (e) => {
      rows = e.payload.rows as CheckReport[];
    });
    await agent.run('go');
    expect(emptyRow(rows)).toMatchObject({ checked: 0, findings: 0, notApplicable: 1 });
  });

  it('a run that calls NO armed tool still files a row — an armed check never sits untouched', async () => {
    // `assertAlive` reads an untouched armed row as wiring rot. A run whose
    // model never asked for the declaring tool must therefore still say
    // something, and `not-applicable` is the honest word for it.
    let rows: CheckReport[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [call('c1', 'fabric_inventory'), answered] }),
      model: 'mock',
      maxIterations: 4,
      noticeEmptyLookups: true,
      integrityPosture: 'dev',
    })
      .system('s')
      .tool(inventory())
      .tool(portLookup(() => []))
      .build();
    agent.on('agentfootprint.integrity.disposition', (e) => {
      rows = e.payload.rows as CheckReport[];
    });
    // Dev posture throws CheckerDeadError on an armed row nobody touched —
    // so completing this run at all is half the assertion.
    await agent.run('go');
    expect(emptyRow(rows).notApplicable).toBeGreaterThanOrEqual(1);
    expect(emptyRow(rows).synthetic).toBe(1);
  });
});

describe('negative: the dial refuses what it cannot honour', () => {
  it('a non-boolean is refused where it is configured, naming what it arms', () => {
    expect(() =>
      Agent.create({
        provider: mock({ replies: [answered] }),
        model: 'mock',
        noticeEmptyLookups: 'yes' as unknown as boolean,
      }).build(),
    ).toThrow(/noticeEmptyLookups must be a boolean/);
  });
});
