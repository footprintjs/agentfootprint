/**
 * The standing fold over REAL runs on the mock provider — what the library
 * actually commits, not a hand-written shape.
 *
 * Test types:
 *   - INTEGRATION — each reason from a real run: an absence with a gap, an
 *                   empty rowset inside a boundary, a bare empty rowset, rows,
 *                   the evidence gate, a limit that cut the turn short, the
 *                   app's answer checks (passed → known; failed → not sure), two
 *                   readings the model stood on that disagree, a typed ask;
 *   - FUNCTIONAL  — `agent.assessment()` (the live snapshot) equals
 *                   `assessAnswer` over the saved recording (a JSON round trip)
 *                   — the running agent and a later reader fold the same bytes —
 *                   and the answer account's "How sure" row says the same word;
 *   - EDGE        — how the turn ended: a paused run of EVERY kind (a typed
 *                   input, `askHuman`, a `checkIn`, a middleware `ask`) reads
 *                   `ask` from the committed state the pause leaves — the saved
 *                   recording alone says it, and so does the account; a run that
 *                   THREW has no answer, so `agent.assessment()` is `undefined`
 *                   and the account says the record shows no answer; an answer
 *                   a rule REFUSED is not returned (`undefined`), while the
 *                   record — and so the account — still holds it; the resumed
 *                   leg still reads the whole turn; `resumeOnError` after an
 *                   `absent()` keeps the absence and its gap (the history holds
 *                   the envelope, and no row is lost to silence); a continued
 *                   conversation reads only its own turn; an envelope returned as
 *                   JSON text — no row — is read off the bytes by the fold, while
 *                   "It found" keeps its events door.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  absent,
  allow,
  ask,
  askHuman,
  coverage,
  defineTool,
  describedResult,
  isInputPause,
  requestInput,
  RunCheckpointError,
  UnsupportedValuesError,
  type OutputSchemaParser,
} from '../../../../src/index.js';
import type { LLMProvider, LLMResponse } from '../../../../src/adapters/types.js';
import { mock } from '../../../../src/llm-providers.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../../../src/observe.js';
import type { AnswerAssessment } from '../../../../src/observe.js';
import type { Recording } from '../../../../src/recorders/observability/recordRun.js';
import { isShowable, showLeaves } from '../../../../src/lib/answer-account/shown.js';
import { assertP1, assertP7 } from '../../../lib/answer-account/helpers.js';

const lookup = (name: string, execute: () => unknown) =>
  defineTool({
    name,
    description: `the ${name} tool`,
    inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
    execute,
  });

const callThen = (name: string, answer: string, args: Record<string, unknown> = {}) =>
  mock({ replies: [{ toolCalls: [{ id: 'c1', name, args }] }, { content: answer }] });

/** Run once; return the live fold, the fold over the saved recording, and the account. */
async function foldOf(
  build: () => Agent,
  message = 'what runs on host-9?',
  { allowListCheck = true }: { allowListCheck?: boolean } = {},
): Promise<{
  live: AnswerAssessment;
  saved: AnswerAssessment;
  recording: Recording;
  agent: Agent;
}> {
  const agent = build();
  const recorder = recordRun(agent);
  await agent.run({ message });
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  recorder.stop();
  const live = (await agent.assessment())!;
  const saved = assessAnswer(recording);
  // One fold, two readers: the running agent and a later reader of the saved bytes agree.
  expect(saved).toEqual(live);
  // …and the person's account says the same word, from the same fold — every pointer it adds
  // resolves into the record (P1) and nothing it prints is a leaf the allow-list refuses (P7).
  const account = accountForAnswer(recording);
  expect(account.facts.standing.value).toBe(live.standing);
  assertP1(account, recording);
  if (allowListCheck) assertP7(account, recording);
  return { live, saved, recording, agent };
}

const reasons = (a: AnswerAssessment) => a.reasons.map((r) => r.reason);

const howSureOf = (recording: Recording) =>
  accountForAnswer(recording)
    .rows.find((r) => r.id === 'how-sure')!
    .lines.map((l) => l.text);

/** A provider that answers from `steps` in order; an `Error` step throws, as a vendor 503 does. */
function scripted(steps: readonly (Error | Partial<LLMResponse>)[]): LLMProvider {
  let i = 0;
  return {
    name: 'scripted',
    async complete(request) {
      const step = steps[i++];
      if (step === undefined || step instanceof Error) throw step ?? new Error('out of replies');
      return mock({ replies: [step] }).complete(request);
    },
  };
}

describe('INTEGRATION — layer 3: what the tools declared, and what came back', () => {
  it('absent() with a notChecked item → not sure: coverage-gap + declared-absent', async () => {
    const { live } = await foldOf(() =>
      Agent.create({ provider: callThen('find_vm', 'No VMs on host-9.'), model: 'mock' })
        .tool(
          lookup('find_vm', () =>
            absent({
              what: 'VMs on host-9',
              checked: ['the VM inventory'],
              notChecked: ['powered-off VMs'],
            }),
          ),
        )
        .build(),
    );
    expect(live.standing).toBe('not-sure');
    expect(reasons(live)).toEqual(['coverage-gap', 'declared-absent']);
    expect(live.checked.find((c) => c.check === 'tool-coverage')).toMatchObject({ ran: 1, of: 1 });
  });

  it('coverage(absent(…)) with a gap on BOTH layers: two rows, one call — the account counts the call', async () => {
    const { live, recording } = await foldOf(() =>
      Agent.create({ provider: callThen('find_vm', 'No VMs on host-9.'), model: 'mock' })
        .tool(
          lookup('find_vm', () =>
            coverage(
              absent({ what: 'VMs on host-9', checked: ['inventory'], notChecked: ['off VMs'] }),
              { checked: ['inventory'], notChecked: ['the archive'] },
            ),
          ),
        )
        .build(),
    );
    // The fold keeps every row as a witness: a boundary row and an absence row, both with a gap.
    expect(live.reasons.map((r) => [r.reason, r.witness.length])).toEqual([
      ['coverage-gap', 2],
      ['declared-absent', 1],
    ]);
    // A person reads CALLS: one call declared the gap.
    expect(howSureOf(recording).slice(0, 3)).toEqual([
      'Not sure — the record holds 2 reasons this answer may not stand:',
      '1 call declared ground it did not check or can never cover.',
      '1 call declared that nothing matched.',
    ]);
  });

  it('coverage([]) → declared-absent read through the boundary (the one emptiness reader)', async () => {
    const { live } = await foldOf(() =>
      Agent.create({ provider: callThen('list_ports', 'No ports are down.'), model: 'mock' })
        .tool(lookup('list_ports', () => coverage([], { checked: ['switch A (live query)'] })))
        .build(),
    );
    expect(reasons(live)).toEqual(['declared-absent']);
    expect(live.reasons[0]!.witness[0]).toMatchObject({ kind: 'history', toolCallId: 'c1' });
  });

  it('a bare [] → not sure: empty-undeclared (silence recorded as silence)', async () => {
    const { live, recording } = await foldOf(() =>
      Agent.create({ provider: callThen('list_ports', 'No ports are down.'), model: 'mock' })
        .tool(lookup('list_ports', () => []))
        .build(),
    );
    expect(reasons(live)).toEqual(['empty-undeclared']);
    const account = accountForAnswer(recording);
    const howSure = account.rows.find((r) => r.id === 'how-sure')!.lines.map((l) => l.text);
    expect(howSure.slice(0, 2)).toEqual([
      'Not sure — the record holds 1 reason this answer may not stand:',
      '1 call returned nothing and did not say what it searched.',
    ]);
  });

  it('rows came back and nothing declared a limit → consistent with the record, never known', async () => {
    const { live } = await foldOf(() =>
      Agent.create({ provider: callThen('list_ports', 'Port 3 is down.'), model: 'mock' })
        .tool(lookup('list_ports', () => [{ port: 3, state: 'down' }]))
        .build(),
    );
    expect(live).toMatchObject({ assessment: 'unrefuted', standing: 'consistent', reasons: [] });
    expect(live.support).toBeUndefined();
  });

  it('an envelope returned as JSON TEXT (no row filed) is read off the bytes by the fold; "It found" keeps its door', async () => {
    const text = JSON.stringify(absent({ what: 'VMs', checked: ['inventory'] }));
    const { live, recording } = await foldOf(() =>
      Agent.create({ provider: callThen('find_vm', 'None.'), model: 'mock' })
        .tool(lookup('find_vm', () => text))
        .build(),
    );
    // No committed row for the call, so the fold reads the envelope the model read — it may
    // over-report (the run never recognized it), it never reads a declaration as silence.
    expect(reasons(live)).toEqual(['declared-absent']);
    expect(live.standing).toBe('not-sure');
    // The account's "It found" reads this run's calls through their EVENTS, which hold a door: the
    // run filed no absence for the call, so the text is data there.
    const found = accountForAnswer(recording).rows.find((r) => r.id === 'found')!;
    expect(found.lines[0]!.text).toBe('find_vm returned a result.');
  });

  it('describedResult(): the account counts the facts and quotes the tool’s source and time', async () => {
    const { live, recording } = await foldOf(
      () =>
        Agent.create({ provider: callThen('backup_runs', 'Two jobs ran.'), model: 'mock' })
          .tool(
            lookup('backup_runs', () =>
              describedResult({
                facts: [
                  { entity: 'job-0001', field: 'status', value: 'succeeded' },
                  { entity: 'job-0002', field: 'status', value: 'succeeded' },
                ],
                provenance: { measuredAt: '2026-08-19T10:12:00Z', source: 'backup API export' },
                coverage: { checked: ['every job in the 02:00 export'] },
              }),
            ),
          )
          .build(),
      undefined,
      // P7 matches a denied leaf as a SUBSTRING of the whole response: every run's receipt holds
      // the enum value 'measured' (`requestMeasurement.status`), and the provenance pointer's
      // PATH ends '/measured_at'. A key name, not a leak — the invariant P7 guards is asserted
      // directly below instead.
      { allowListCheck: false },
    );
    const account = accountForAnswer(recording);
    const found = account.rows.find((r) => r.id === 'found')!;
    expect(found.lines.map((l) => l.text)).toEqual([
      'backup_runs returned 2 facts.',
      'backup_runs says the data came from backup API export, as of 2026-08-19T10:12:00Z.',
    ]);
    expect(found.lines[1]!.source).toBe('tool:backup_runs');
    // What P7 protects, for this result: the data itself never leaves — only its count and the
    // tool's allow-listed source and time do.
    const response = JSON.stringify({ account, shown: showLeaves(account, recording) });
    for (const value of ['job-0001', 'job-0002', 'succeeded']) {
      expect(response.includes(value), value).toBe(false);
    }
    for (const variable of Object.values(found.lines[1]!.vars)) {
      if (variable.from !== undefined) expect(isShowable(variable.from)).toBe(true);
    }
    // The fold reads committed rows only: the projection in history carries no marker, so the
    // shape is not read — but the declared boundary is a coverage row, and a check ran.
    expect(live.checked.find((c) => c.check === 'tool-coverage')).toMatchObject({ ran: 1, of: 1 });
    expect(live.standing).toBe('consistent');
  });
});

describe('INTEGRATION — layer 3: two readings the model stood on disagree', () => {
  it('fact(c1: down) and fact(c2: up) on one key → sources-conflict', async () => {
    const assertion = (value: string) => ({
      subject: { kind: 'port', id: 'p1' },
      predicate: 'status',
      value,
    });
    const provider = mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'look', args: { host: 'a' } }] },
        {
          toolCalls: [
            {
              id: 'c2',
              name: 'look',
              args: {
                host: 'b',
                _findings: {
                  basis: 'exploratory',
                  previous: [
                    { toolCallId: 'c1', standing: 'fact', assertions: [assertion('down')] },
                  ],
                },
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              id: 'c3',
              name: 'look',
              args: {
                host: 'c',
                _findings: {
                  basis: 'exploratory',
                  previous: [{ toolCallId: 'c2', standing: 'fact', assertions: [assertion('up')] }],
                },
              },
            },
          ],
        },
        { content: 'p1 is down.' },
      ] as never,
    });
    const { live } = await foldOf(
      () =>
        Agent.create({ provider, model: 'mock', maxIterations: 6 })
          .tool(lookup('look', () => [{ port: 'p1' }]))
          .findings()
          .build(),
      undefined,
      // P7 matches a denied leaf as a SUBSTRING of the whole response, and an armed run's served
      // `_findings` schema carries the bare string 'toolCallId' as a value — which every account
      // pointer path '/toolCallId' then "contains". A key name, not a leak; P1 still runs.
      { allowListCheck: false },
    );
    expect(reasons(live)).toEqual(['sources-conflict']);
    expect(live.reasons[0]!.witness[0]).toMatchObject({ kind: 'state', key: 'findingsLedger' });
  });
});

describe('INTEGRATION — layer 4: the answer’s own rows', () => {
  it('the evidence gate flagged a value → value-unsupported', async () => {
    const { live } = await foldOf(() =>
      Agent.create({ provider: callThen('list_ports', 'Port srv-4417 is down.'), model: 'mock' })
        .tool(lookup('list_ports', () => [{ port: 3 }]))
        .namesAndNumbersFromEvidence({})
        .build(),
    );
    expect(reasons(live)).toEqual(['value-unsupported']);
    expect(live.checked.find((c) => c.check === 'names-and-numbers')).toMatchObject({
      ran: 1,
      of: 1,
    });
  });

  it('a limit cut the turn short → stopped-early', async () => {
    const provider = mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'look', args: {} }] },
        { toolCalls: [{ id: 'c2', name: 'look', args: {} }] },
        { toolCalls: [{ id: 'c3', name: 'look', args: {} }] },
        { content: 'partial' },
      ] as never,
    });
    const { live } = await foldOf(() =>
      Agent.create({ provider, model: 'mock', maxIterations: 1, wrapUpAtMaxIterations: false })
        .tool(lookup('look', () => [{ ok: true }]))
        .build(),
    );
    expect(reasons(live)).toContain('stopped-early');
  });

  interface Count {
    count: number;
  }
  const countParser: OutputSchemaParser<Count> = {
    parse(value: unknown): Count {
      const v = value as Partial<Count> | null;
      if (v === null || typeof v !== 'object' || typeof v.count !== 'number') {
        throw new Error('count is required');
      }
      return { count: v.count };
    },
  };

  it('a passed ENFORCE answer check → known, supported by the report’s digest', async () => {
    const { live } = await foldOf(() =>
      Agent.create({ provider: mock({ reply: '{"count":3}' }), model: 'mock' })
        .outputSchema(countParser)
        .answerValidation<Count>({
          id: 'count-check',
          version: '1',
          validate: (c) => ({
            checks: [{ id: 'three', disposition: c.count === 3 ? 'checked-pass' : 'checked-fail' }],
          }),
        })
        .build(),
    );
    expect(live).toMatchObject({ assessment: 'known', standing: 'known', reasons: [] });
    expect(live.support?.kind).toBe('answer-validation');
    expect(live.support?.reportDigest).toMatch(/\S/);
  });

  it('a failed OBSERVE answer check → not sure: answer-check-failed', async () => {
    const { live } = await foldOf(() =>
      Agent.create({ provider: mock({ reply: '{"count":4}' }), model: 'mock' })
        .outputSchema(countParser)
        .answerValidation<Count>({
          id: 'count-check',
          version: '1',
          mode: 'observe',
          validate: (c) => ({
            checks: [{ id: 'three', disposition: c.count === 3 ? 'checked-pass' : 'checked-fail' }],
          }),
        })
        .build(),
    );
    expect(reasons(live)).toEqual(['answer-check-failed']);
  });
});

describe('EDGE — how the turn ended: a pause of every kind, a run that threw', () => {
  /** list_ports returns rows, then `act` pauses the run — the turn has no answer yet. */
  const pausing =
    (
      act: ReturnType<typeof lookup>,
      extra?: (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
    ) =>
    () => {
      const b = Agent.create({
        provider: mock({
          replies: [
            { toolCalls: [{ id: 'c0', name: 'list_ports', args: {} }] },
            { toolCalls: [{ id: 'c1', name: 'act', args: {} }] },
            { content: 'never reached' },
          ] as never,
        }),
        model: 'mock',
      }).tools([lookup('list_ports', () => [{ port: 3, state: 'down' }]), act]);
      return (extra ? extra(b) : b).build();
    };

  it.each([
    [
      'askHuman — a question whose answer becomes the tool’s result',
      pausing(lookup('act', () => askHuman({ question: 'Shut port 3 down?' }))),
    ],
    [
      'checkIn — a tool’s own consent gate',
      pausing(
        defineTool({
          name: 'act',
          description: 'shut a port',
          inputSchema: { type: 'object', properties: {} },
          checkIn: 'always',
          execute: () => 'shut',
        }),
      ),
    ],
    [
      'a middleware ask',
      pausing(
        lookup('act', () => 'shut'),
        (b) =>
          b.toolMiddleware({
            name: 'gate',
            onToolCall: (call) =>
              call.toolName === 'act' ? ask({ question: 'approve?' }) : allow(),
          }),
      ),
    ],
  ])('%s: ask — live, from the saved recording alone, and in the account', async (_kind, build) => {
    // foldOf pins live = saved (no checkpoint) = the account's word.
    const { live, recording } = await foldOf(build);
    expect(live.standing).toBe('ask');
    expect(reasons(live)).toEqual(['asked']);
    expect(live.reasons[0]!.witness).toEqual([
      { kind: 'state', key: 'pausedToolCallId', path: '' },
    ]);
    expect(howSureOf(recording).slice(0, 2)).toEqual([
      'Ask — the run stopped to ask a question before it could answer:',
      'A question the run asked is still waiting for its answer.',
    ]);
  });

  it('a run that THREW has no answer: agent.assessment() is undefined, and the account says so', async () => {
    const agent = Agent.create({
      provider: scripted([
        { toolCalls: [{ id: 't1', name: 'list_hosts', args: {} }] },
        new Error('vendor 503'),
      ]),
      model: 'mock',
    })
      .tool(lookup('list_hosts', () => [{ host: 'host-9' }]))
      .build();
    const recorder = recordRun(agent);
    await expect(agent.run({ message: 'hosts?' })).rejects.toBeInstanceOf(RunCheckpointError);
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    recorder.stop();
    expect(agent.getLastSnapshot()).toBeDefined(); // there IS a record — just no answer on it
    expect(await agent.assessment()).toBeUndefined();
    const account = accountForAnswer(recording);
    expect(account.facts.standing).toMatchObject({ value: null, status: 'not-recorded' });
    expect(howSureOf(recording)[0]).toBe(
      'How sure cannot be told: this record does not show the run giving an answer.',
    );
    assertP1(account, recording);
    assertP7(account, recording);
  });

  it('an answer a rule REFUSED: run() returned none (undefined); the record holds it, and the account rates it', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'list_ports', args: {} }] },
          { content: 'Port srv-4417 is down.' },
          { content: 'Port srv-4417 is down.' },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(lookup('list_ports', () => [{ port: 3 }]))
      .namesAndNumbersFromEvidence({ posture: 'rails' })
      .build();
    const recorder = recordRun(agent);
    await expect(agent.run({ message: 'which port is down?' })).rejects.toThrow(
      UnsupportedValuesError,
    );
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    recorder.stop();
    expect(await agent.assessment()).toBeUndefined(); // the caller got an error, not an answer
    // The record holds the refused answer (its turn_end), and the reasons name the refusal.
    expect(recording.events.some((e) => e.type === 'agentfootprint.agent.turn_end')).toBe(true);
    expect(reasons(assessAnswer(recording))).toEqual(['value-survived-revision']);
    expect(accountForAnswer(recording).facts.standing.value).toBe('not-sure');
  });

  it('resumeOnError after absent(): the absence and its gap are still read (the envelope is in history)', async () => {
    const agent = Agent.create({
      provider: scripted([
        { toolCalls: [{ id: 't1', name: 'find_vm', args: {} }] },
        new Error('transient vendor 503'),
        { toolCalls: [{ id: 't2', name: 'list_hosts', args: {} }] },
        { content: 'No VMs are hosted on host-9.' },
      ]),
      model: 'mock',
    })
      .tools([
        lookup('find_vm', () =>
          absent({
            what: 'VMs on host-9',
            checked: ['the VM inventory'],
            notChecked: ['powered-off VMs'],
          }),
        ),
        lookup('list_hosts', () => [{ host: 'host-9' }]),
      ])
      .build();
    const failed = await agent.run({ message: 'what runs on host-9?' }).catch((e: unknown) => e);
    if (!(failed instanceof RunCheckpointError)) throw new Error('expected a checkpoint error');
    expect(await agent.assessment()).toBeUndefined(); // the failed leg has no answer
    const recorder = recordRun(agent);
    const answer = await agent.resumeOnError(failed.checkpoint);
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    recorder.stop();
    expect(answer).toBe('No VMs are hosted on host-9.');
    // The checkpoint carries history, not `coverageDeclared` — the row is gone, the envelope is not.
    const state = agent.getLastSnapshot()!.sharedState as { coverageDeclared?: unknown };
    expect(state.coverageDeclared).toBeUndefined();
    const live = (await agent.assessment())!;
    expect(live.standing).toBe('not-sure');
    expect(reasons(live)).toEqual(['coverage-gap', 'declared-absent']);
    expect(assessAnswer(recording)).toEqual(live);
    expect(accountForAnswer(recording).facts.standing.value).toBe('not-sure');
  });
});

describe('EDGE — a typed ask, a resumed leg, a continued conversation', () => {
  const askYear = () =>
    lookup('ask_year', () =>
      requestInput({
        id: 'year',
        question: 'Which year?',
        fields: [{ id: 'year', type: 'number', required: true }],
      }),
    );

  it('a paused run: ask — read from the committed state the pause leaves, never from its event', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c0', name: 'list_ports', args: {} }] },
          { toolCalls: [{ id: 'c1', name: 'ask_year', args: {} }] },
          { content: 'In 2026 there were none.' },
        ] as never,
      }),
      model: 'mock',
    })
      .tools([askYear(), lookup('list_ports', () => [])])
      .build();
    const recorder = recordRun(agent);
    const paused = await agent.run({ message: 'ports down last year?' });
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    recorder.stop();
    if (!isInputPause(paused as never)) throw new Error('expected an input pause');
    const checkpoint = (paused as { checkpoint: unknown }).checkpoint;

    const live = (await agent.assessment())!;
    expect(live.standing).toBe('ask');
    expect(reasons(live)).toEqual(['asked', 'empty-undeclared']);
    // One fold, every carrier: the saved recording ALONE, the checkpoint alone, or both.
    expect(assessAnswer(recording)).toEqual(live);
    expect(assessAnswer({ checkpoint })).toEqual(live);
    expect(assessAnswer({ snapshot: recording.snapshot, checkpoint })).toEqual(live);
    // …and the person's account says the same word, pointing at the committed state.
    const account = accountForAnswer(recording);
    expect(account.facts.standing.value).toBe('ask');
    expect(account.facts.standing.status).toBe('recorded');
    expect(howSureOf(recording).slice(0, 4)).toEqual([
      'Ask — the run stopped to ask a question before it could answer:',
      'A question the run asked is still waiting for its answer.',
      '1 call returned nothing and did not say what it searched.',
      "The library was not set to check the answer's names and numbers.",
    ]);
    assertP1(account, recording);
    assertP7(account, recording);

    // The resumed leg's log starts at the pause; the turn began before it and is still read whole.
    const r2 = recordRun(agent);
    const p = paused as { checkpoint: unknown; awaitingInput: { requestId: string } };
    await agent.resume(p.checkpoint as never, {
      requestId: p.awaitingInput.requestId,
      values: { year: 2026 },
    });
    const leg = JSON.parse(JSON.stringify(r2.toRecording())) as Recording;
    r2.stop();
    const resumed = assessAnswer(leg);
    expect(resumed.turnFrom).toBe('person');
    expect(reasons(resumed)).toEqual(['empty-undeclared']); // c0's [] from before the pause
    expect(await agent.assessment()).toEqual(resumed);
  });

  it('a continued conversation: an earlier turn’s empty result is not this answer’s', async () => {
    const provider = mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'list_ports', args: {} }] },
        { content: 'none' },
        { toolCalls: [{ id: 'c2', name: 'list_ports', args: {} }] },
        { content: 'port 3' },
      ] as never,
    });
    let call = 0;
    const agent = Agent.create({ provider, model: 'mock' })
      .tool(lookup('list_ports', () => (call++ === 0 ? [] : [{ port: 3 }])))
      .build();
    await agent.run({ message: 'which ports are down?' });
    expect(reasons((await agent.assessment())!)).toEqual(['empty-undeclared']);
    await agent.run({ message: 'and now?', continueFrom: agent.checkpoint()! } as never);
    const turn2 = (await agent.assessment())!;
    expect(turn2.standing).toBe('consistent');
    expect(turn2.checked.find((c) => c.check === 'result-shape')).toMatchObject({ ran: 1, of: 1 });
  });

  it('before any run there is nothing to assess', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'x' }), model: 'mock' }).build();
    expect(await agent.assessment()).toBeUndefined();
  });
});
