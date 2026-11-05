/**
 * Integrity findings reach the answer's standing — through real runs.
 *
 * Test types (Convention 3):
 *   - SCENARIO — each kind a run can file, on all three chart shapes where the
 *     seam lives behind a subflow, under the equality law;
 *   - PROPERTY — seeded configurations: the in-run standing equals
 *     `assessAnswer(savedRecording)`, whichever findings fired;
 *   - BOUNDARY — no row or key while the answer layer is not armed, and no value
 *     on a row, under a redaction policy or without one.
 *
 * The compose-seam `invariant-violation` is not here: the park hold-out keeps a
 * live run from reaching it (`test/integrity/invariantViolation.test.ts` pins
 * that), so its row is covered in `integrityReasons.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { Agent, askHuman, defineTool, describedResult, slidingWindow } from '../../../index.js';
import { isPaused } from '../../pause.js';
import { mock } from '../../../llm-providers.js';
import { assessAnswer, recordRun } from '../../../observe.js';
import { assessmentDataOf, type AnswerAssessmentData } from './compose.js';
import type { AnswerAssessment } from './types.js';

type ReactMode = 'classic' | 'dynamic' | 'dynamic-grouped';
const MODES: readonly ReactMode[] = ['classic', 'dynamic', 'dynamic-grouped'];

const SECRET = 'bkp-4417-ganymede-tier2';
const DEVICE = '20:00:00:25:b5:aa:bb:cc';

const inventory = () =>
  defineTool({
    name: 'fabric_inventory',
    description: 'Lists the devices by their real ids.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => `device ${DEVICE} is online`,
  });

const backupStatus = () =>
  defineTool({
    name: 'backup_status',
    description: 'Reads the backup record for one machine.',
    inputSchema: {
      type: 'object',
      properties: { machine: { type: 'string' } },
      required: ['machine'],
    },
    argumentsFrom: ['fabric_inventory'],
    execute: () => 'a record',
  });

const portLookup = () =>
  defineTool({
    name: 'port_for_device',
    description: 'Which port a device is logged in to.',
    inputSchema: {
      type: 'object',
      properties: { wwpn: { type: 'string' } },
      required: ['wwpn'],
    },
    argumentsFrom: ['fabric_inventory'],
    execute: () => [],
  });

const lunMap = (rows: unknown) =>
  defineTool({
    name: 'lun_map',
    description: 'The LUN mappings.',
    inputSchema: { type: 'object', properties: {} },
    resultColumns: { logical_unit_number: 'number' } as never,
    execute: () => rows,
  });

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const answered = (content = 'The answer.') => ({
  content,
  toolCalls: [],
  stopReason: 'stop' as const,
});

interface Ran {
  readonly inRun: AnswerAssessmentData | undefined;
  readonly saved: AnswerAssessment;
  readonly live: AnswerAssessment | undefined;
  readonly ledger: readonly Record<string, unknown>[];
  readonly state: Record<string, unknown>;
  readonly recordingText: string;
}

/** One run with the equality law held on it, read back from a JSON round trip. */
async function run(agent: Agent, drive: () => Promise<unknown>): Promise<Ran> {
  let inRun: AnswerAssessmentData | undefined;
  const off = agent.on('agentfootprint.answer.assessed', (e) => {
    const { turn: _t, iteration: _i, ...data } = e.payload as unknown as Record<string, unknown>;
    void _t;
    void _i;
    inRun = data as unknown as AnswerAssessmentData;
  });
  const recorder = recordRun(agent);
  await drive();
  const recordingText = JSON.stringify(recorder.toRecording());
  recorder.stop();
  off();
  const saved = assessAnswer(JSON.parse(recordingText));
  const live = await agent.assessment();
  if (inRun !== undefined) {
    expect(assessmentDataOf(saved)).toEqual(inRun);
    expect(live).toEqual(saved);
  }
  const state = agent.getLastSnapshot()?.sharedState as Record<string, unknown>;
  const ledger = (state.findingsLedger ?? []) as Record<string, unknown>[];
  return { inRun, saved, live, ledger, state, recordingText };
}

const rowsOf = (r: Ran) => r.ledger.filter((row) => row.kind === 'integrity-finding');
const reasonsOf = (a: AnswerAssessment) => a.reasons.map((x) => x.reason);
const notesOf = (a: AnswerAssessment) => (a.notes ?? []).map((n) => n.finding);

describe('SCENARIO — each kind a run can file', () => {
  it.each(MODES)('invariant-violation on the wire lowers the standing (%s)', async (reactMode) => {
    const drift = { toolNames: ['backup_status', 'fabric_inventory', 'ghost_tool'] };
    const agent = Agent.create({
      provider: mock({
        replies: [
          { ...call('c1', 'fabric_inventory'), wireManifest: drift },
          { ...call('c2', 'fabric_inventory'), wireManifest: drift },
          { ...answered(), wireManifest: drift },
        ],
      }),
      model: 'mock',
      reactMode,
    })
      .tools([inventory(), backupStatus()])
      .answerLayer()
      .build();
    const r = await run(agent, () => agent.run({ message: 'go' }));
    expect(r.saved.standing).toBe('not-sure');
    expect(reasonsOf(r.saved)).toContain('invariant-violation');
    // Re-detected on every call, filed once: the rail's dedup is the row's.
    expect(rowsOf(r)).toHaveLength(1);
    expect(rowsOf(r)[0]).toMatchObject({
      finding: 'invariant-violation',
      seam: 'wire',
      turn: 1,
      tools: ['ghost_tool'],
    });
    expect(r.state.integrityFindingRows).toBeUndefined();
  });

  it.each(MODES)(
    'unsupported-argument names its call and holds no value (%s)',
    async (reactMode) => {
      const agent = Agent.create({
        provider: mock({
          replies: [
            call('c1', 'fabric_inventory'),
            call('c2', 'backup_status', { machine: SECRET }),
            answered(),
          ],
        }),
        model: 'mock',
        reactMode,
      })
        .tools([inventory(), backupStatus()])
        .answerLayer()
        .build();
      const r = await run(agent, () => agent.run({ message: 'go' }));
      expect(r.saved.standing).toBe('not-sure');
      const reason = r.saved.reasons.find((x) => x.reason === 'unsupported-argument');
      expect(reason?.source).toEqual({
        kind: 'calls',
        calls: [{ toolCallId: 'c2', toolName: 'backup_status' }],
      });
      expect(JSON.stringify(rowsOf(r))).not.toContain(SECRET);
    },
  );

  it.each([
    ['column-type-mismatch', [{ logical_unit_number: '' }]],
    ['missing-column', [{ other: 1 }]],
  ] as const)('%s lowers the standing and names the call', async (reason, rows) => {
    const agent = Agent.create({
      provider: mock({ replies: [call('c1', 'lun_map'), answered()] }),
      model: 'mock',
      checkColumnTypes: 'warn',
    })
      .tool(lunMap(rows))
      .answerLayer()
      .build();
    const r = await run(agent, () => agent.run({ message: 'go' }));
    expect(reasonsOf(r.saved)).toEqual([reason]);
    expect(r.saved.reasons[0]!.source).toEqual({
      kind: 'calls',
      calls: [{ toolCallId: 'c1', toolName: 'lun_map' }],
    });
  });

  it('empty-lookup is a note, not a reason of its own', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          call('c1', 'fabric_inventory'),
          call('c2', 'port_for_device', { wwpn: DEVICE }),
          answered(),
        ],
      }),
      model: 'mock',
      noticeEmptyLookups: true,
    })
      .tools([inventory(), portLookup()])
      .answerLayer()
      .build();
    const r = await run(agent, () => agent.run({ message: 'go' }));
    expect(notesOf(r.saved)).toEqual(['empty-lookup']);
    expect(reasonsOf(r.saved)).not.toContain('empty-lookup');
    // The empty result reads "not sure" on its own account, as it did before.
    expect(reasonsOf(r.saved)).toEqual(['empty-undeclared']);
    expect(rowsOf(r)[0]).toMatchObject({
      advisory: true,
      tools: ['port_for_device', 'fabric_inventory'],
    });
  });

  it('dangling-reference is a note, for a tool the model may never call', async () => {
    let calls = 0;
    const agent = Agent.create({
      provider: {
        name: 'mock',
        complete: async () => {
          calls += 1;
          const usage = { input: 10, output: 5 };
          if (calls > 8) return { ...answered('done'), usage };
          return { ...call(`c${calls}`, calls === 1 ? 'whats_here' : 'screen_fire'), usage };
        },
      } as never,
      model: 'm',
      maxIterations: 12,
      keepLastToolResults: false,
    })
      .tool(
        defineTool({
          name: 'whats_here',
          description: 'lists the ids',
          inputSchema: { type: 'object', properties: {} },
          execute: () => `IDS ${'x'.repeat(600)}`,
        }),
      )
      .tool(
        defineTool({
          name: 'screen_fire',
          description: 'fires an id',
          inputSchema: { type: 'object', properties: {} },
          argumentsFrom: ['whats_here'],
          execute: () => 'fired',
        }),
      )
      .window(slidingWindow({ keepRecentTurns: 2 }))
      .answerLayer()
      .build();
    const r = await run(agent, () => agent.run({ message: 'Walk the floor.' }));
    expect(notesOf(r.saved)).toEqual(['dangling-reference']);
    expect(r.saved.reasons).toEqual([]);
  });

  it('prior-turn-evidence is a note on the turn it was filed on', async () => {
    const replies = [
      call('c1', 'array_inventory'),
      answered('Array ARR-77 holds 512 GB.'),
      answered('ARR-77 is at 512 GB.'),
    ];
    const agent = Agent.create({
      provider: mock({ replies }),
      model: 'mock',
      noticePriorTurnEvidence: true,
    })
      .tool(
        defineTool({
          name: 'array_inventory',
          description: 'the arrays',
          inputSchema: { type: 'object', properties: {} },
          execute: () => JSON.stringify({ array: 'ARR-77', capacity: 512 }),
        }),
      )
      .namesAndNumbersFromEvidence()
      .answerLayer()
      .build();
    const first = await run(agent, () => agent.run('what arrays?'));
    expect(notesOf(first.saved)).toEqual([]);
    const second = await run(agent, () => agent.followUp('how much?'));
    expect(notesOf(second.saved)).toEqual(['prior-turn-evidence']);
    expect(reasonsOf(second.saved)).not.toContain('prior-turn-evidence');
  });

  it('a finding says nothing about the next turn of the conversation', async () => {
    const agent = Agent.create({
      provider: mock({ replies: [call('c1', 'lun_map'), answered(), answered('Thanks.')] }),
      model: 'mock',
      checkColumnTypes: 'warn',
    })
      .tool(lunMap([{ other: 1 }]))
      .answerLayer()
      .build();
    const first = await run(agent, () => agent.run('go'));
    expect(reasonsOf(first.saved)).toEqual(['missing-column']);
    const second = await run(agent, () => agent.followUp('and now?'));
    expect(reasonsOf(second.saved)).not.toContain('missing-column');
    // The carried row is still on the ledger: the fold reads this turn's rows only.
    expect(rowsOf(second).map((row) => row.turn)).toEqual([1]);
  });

  it('a row filed before a pause survives it and reaches the resumed answer', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [call('c1', 'lun_map'), call('c2', 'act'), answered('Done.')],
      }),
      model: 'mock',
      checkColumnTypes: 'warn',
    })
      .tools([
        lunMap([{ other: 1 }]),
        defineTool({
          name: 'act',
          description: 'acts',
          inputSchema: { type: 'object', properties: {} },
          execute: () => askHuman({ question: 'Sure?' }),
        }),
      ])
      .answerLayer()
      .build();
    let paused: unknown;
    const first = await run(agent, async () => {
      paused = await agent.run({ message: 'go' });
    });
    expect(isPaused(paused as never)).toBe(true);
    expect(first.saved.standing).toBe('ask');
    const second = await run(agent, () =>
      agent.resume((paused as { checkpoint: unknown }).checkpoint as never, 'yes'),
    );
    expect(reasonsOf(second.saved)).toEqual(['missing-column']);
    expect(rowsOf(second)).toHaveLength(1);
  });
});

describe('SCENARIO — .claims()', () => {
  const screen = () =>
    defineTool({
      name: 'whats_here',
      description: 'inspects the screen',
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        describedResult({
          facts: [{ entity: 'screen2', nav: 2 }],
          provenance: { measuredAt: '2026-08-20T00:00:00Z', source: 'test-harness' },
        }),
    });
  const parser = { parse: (v: unknown) => v };

  const claimRun = (answer: Record<string, unknown>, claims: Record<string, unknown>) => {
    const agent = Agent.create({
      provider: mock({ replies: [call('c1', 'whats_here'), answered(JSON.stringify(answer))] }),
      model: 'mock',
    })
      .tool(screen())
      .outputSchema(parser)
      .claims(claims as never)
      .answerLayer()
      .build();
    return run(agent, () => agent.run({ message: 'go' }));
  };
  const CONTRACT = { nav_count: { entity: 'screen2', field: 'nav' } };

  it('a contradicted field lowers the standing, resting on the answer', async () => {
    const r = await claimRun({ nav_count: 9 }, CONTRACT);
    expect(r.saved.standing).toBe('not-sure');
    expect(r.saved.reasons.find((x) => x.reason === 'unsupported-claim')?.source).toEqual({
      kind: 'answer',
    });
    expect(JSON.stringify(rowsOf(r))).not.toContain('9');
  });

  it('a field declining to state a settled fact lowers it too, marked advisory', async () => {
    const r = await claimRun({ nav_count: null }, CONTRACT);
    expect(reasonsOf(r.saved)).toContain('unsupported-claim');
    expect(rowsOf(r)[0]).toMatchObject({ advisory: true });
  });

  it('a field whose fact no tool settled reads not sure with its own reason', async () => {
    const r = await claimRun({ other: 5 }, { other: { entity: 'screen9', field: 'nothing' } });
    expect(r.saved.standing).toBe('not-sure');
    expect(reasonsOf(r.saved)).toContain('claim-unsettled');
    expect(r.ledger.find((row) => row.kind === 'claim-unsettled')).toEqual({
      kind: 'claim-unsettled',
      turn: 1,
      iteration: 2,
      field: 'other',
    });
    expect(JSON.stringify(r.ledger)).not.toContain('"5"');
  });

  it('an agreeing field is unchanged: no row, no reason', async () => {
    const r = await claimRun({ nav_count: 2 }, CONTRACT);
    expect(reasonsOf(r.saved)).not.toContain('unsupported-claim');
    expect(reasonsOf(r.saved)).not.toContain('claim-unsettled');
    expect(r.ledger.filter((row) => row.kind === 'claim-unsettled')).toEqual([]);
    expect(rowsOf(r)).toEqual([]);
  });

  it('a field the answer does not state files nothing', async () => {
    const r = await claimRun({ unrelated: 1 }, CONTRACT);
    expect(reasonsOf(r.saved)).not.toContain('claim-unsettled');
  });
});

describe('REGRESSION — a second finding in a later pass of the grouped chart', () => {
  // The seen-list crossed `sf-llm-call` under its own key, read-only in there, so
  // an observe-only check failed the run with "Cannot write to readonly input key".
  it.each([true, false])('the run still answers (answer layer armed: %s)', async (armed) => {
    const drift = { toolNames: ['backup_status', 'fabric_inventory', 'ghost_tool'] };
    const events: unknown[] = [];
    let builder = Agent.create({
      provider: mock({
        replies: [
          { ...call('c1', 'fabric_inventory'), wireManifest: drift },
          { ...call('c2', 'backup_status', { machine: SECRET }), wireManifest: drift },
          { ...answered(), wireManifest: drift },
        ],
      }),
      model: 'mock',
      reactMode: 'dynamic-grouped',
    }).tools([inventory(), backupStatus()]);
    if (armed) builder = builder.answerLayer();
    const agent = builder.build();
    agent.on('agentfootprint.integrity.context_error', (e) => events.push(e.payload));
    const r = await run(agent, () => agent.run({ message: 'go' }));
    expect(events).toHaveLength(2);
    if (armed) {
      expect(reasonsOf(r.saved)).toEqual(
        expect.arrayContaining(['invariant-violation', 'unsupported-argument']),
      );
      expect(rowsOf(r)).toHaveLength(2);
    }
  });
});

describe('BOUNDARY — not armed, nothing moves', () => {
  it.each(MODES)('no row and no key, whatever the checks filed (%s)', async (reactMode) => {
    const events: unknown[] = [];
    const drift = { toolNames: ['fabric_inventory', 'backup_status', 'lun_map', 'ghost_tool'] };
    const agent = Agent.create({
      provider: mock({
        replies: [
          { ...call('c1', 'lun_map'), wireManifest: drift },
          { ...call('c2', 'backup_status', { machine: SECRET }), wireManifest: drift },
          { ...answered(), wireManifest: drift },
        ],
      }),
      model: 'mock',
      reactMode,
      checkColumnTypes: 'warn',
    })
      .tools([inventory(), backupStatus(), lunMap([{ other: 1 }])])
      .build();
    agent.on('agentfootprint.integrity.context_error', (e) => events.push(e.payload));
    const r = await run(agent, () => agent.run({ message: 'go' }));
    // The seams ran: the events are the ones they always were.
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(r.state.findingsLedger).toBeUndefined();
    expect(r.recordingText).not.toContain('integrityFindingRows');
    expect(r.recordingText).not.toContain('integrity-finding');
  });

  it('a .claims() field no tool settled files no row', async () => {
    const agent = Agent.create({
      provider: mock({ replies: [answered(JSON.stringify({ other: 5 }))] }),
      model: 'mock',
    })
      .outputSchema({ parse: (v: unknown) => v })
      .claims({ other: { entity: 'screen9', field: 'nothing' } })
      .build();
    const r = await run(agent, () => agent.run({ message: 'go' }));
    expect(r.state.findingsLedger).toBeUndefined();
    expect(r.recordingText).not.toContain('claim-unsettled');
  });

  it('the events are the same bytes with the layer armed or not', async () => {
    const eventsOf = async (armed: boolean) => {
      const events: unknown[] = [];
      let builder = Agent.create({
        provider: mock({ replies: [call('c1', 'lun_map'), answered()] }),
        model: 'mock',
        checkColumnTypes: 'warn',
      }).tool(lunMap([{ other: 1 }]));
      if (armed) builder = builder.answerLayer();
      const agent = builder.build();
      agent.on('agentfootprint.integrity.context_error', (e) => events.push(e.payload));
      await agent.run({ message: 'go' });
      return events;
    };
    expect(await eventsOf(true)).toEqual(await eventsOf(false));
  });
});

describe('BOUNDARY — a redaction policy', () => {
  it('no private argument on a row or in the served snapshot rows, and the law holds', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          call('c1', 'fabric_inventory'),
          call('c2', 'backup_status', { machine: SECRET }),
          answered(),
        ],
      }),
      model: 'mock',
      redact: { keys: ['machine'] },
    })
      .tools([inventory(), backupStatus()])
      .answerLayer()
      .build();
    const r = await run(agent, () => agent.run({ message: 'go' }));
    expect(reasonsOf(r.saved)).toContain('unsupported-argument');
    const served = JSON.parse(r.recordingText).snapshot.sharedState.findingsLedger as unknown[];
    expect(JSON.stringify(served)).not.toContain(SECRET);
    expect(served.some((row) => (row as { kind?: string }).kind === 'integrity-finding')).toBe(
      true,
    );
  });
});

describe('PROPERTY — the in-run standing equals the saved recording', () => {
  function prng(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('40 seeded configurations', async () => {
    for (let seed = 0; seed < 40; seed++) {
      const next = prng(seed + 1);
      const on = () => next() < 0.5;
      const reactMode = MODES[Math.floor(next() * MODES.length)]!;
      const wire = on();
      const argument = on();
      const lookup = on();
      const column = on();
      const rows = column ? (on() ? [{ logical_unit_number: '' }] : [{ other: 1 }]) : [];
      const manifest = wire ? { wireManifest: { toolNames: ['ghost_tool'] } } : {};
      const replies = [
        { ...call('c1', 'fabric_inventory'), ...manifest },
        ...(argument ? [{ ...call('a', 'backup_status', { machine: SECRET }), ...manifest }] : []),
        ...(lookup ? [{ ...call('l', 'port_for_device', { wwpn: DEVICE }), ...manifest }] : []),
        ...(column ? [{ ...call('k', 'lun_map'), ...manifest }] : []),
        { ...answered(), ...manifest },
      ];
      const agent = Agent.create({
        provider: mock({ replies }),
        model: 'mock',
        reactMode,
        noticeEmptyLookups: true,
        checkColumnTypes: 'warn',
      })
        .tools([inventory(), backupStatus(), portLookup(), lunMap(rows)])
        .answerLayer()
        .build();
      const r = await run(agent, () => agent.run({ message: 'go' }));
      const label = `seed ${seed}`;
      expect(r.inRun, label).toBeDefined();
      const has = (reason: string) => reasonsOf(r.saved).includes(reason as never);
      expect(has('invariant-violation'), label).toBe(wire);
      expect(has('unsupported-argument'), label).toBe(argument);
      expect(has('column-type-mismatch') || has('missing-column'), label).toBe(column);
      expect(notesOf(r.saved).includes('empty-lookup'), label).toBe(lookup);
      if (wire || argument || column) expect(r.saved.standing, label).toBe('not-sure');
    }
  });
});
