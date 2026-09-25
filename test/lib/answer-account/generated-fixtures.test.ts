/**
 * Fixtures C–G — REAL library runs with the mock provider, read back from the
 * recording the agent itself mints (`artifacts: { recordings: true }` — the
 * exact bytes the hosting op will read), or from `recordRun` where no recording
 * is minted (a run that failed). One exception, named: D is SYNTHETIC, because
 * no library path withholds an entry-routed skill today (tier 1 ignores every
 * hidden set; the skill body always reaches the system prompt) — so D is a real
 * entry-routed run with the delivery rewritten, and says so.
 *
 * Test types:
 *   - FUNCTIONAL  — each fixture prints the lines the design's §2 tables pick;
 *   - EDGE        — the §2.10 missing-fact walk (fixture E);
 *   - REGRESSION  — each fixture's text is a byte-stable golden;
 *   - INTEGRATION — the account reads what the library actually records, not a
 *                   hand-written shape.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  allow,
  ask,
  checkInDeclined,
  defineTool,
  deny,
  inMemoryArtifacts,
  isAskPause,
  isInputPause,
  requestInput,
} from '../../../src/index.js';
import type { AgentfootprintEvent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { recordRun } from '../../../src/observe.js';
import type { PermissionChecker } from '../../../src/adapters/types.js';
import { defineSkill, keywordScorer, skillGraph } from '../../../src/injection-engine.js';
import { accountForAnswer } from '../../../src/lib/answer-account/account.js';
import type {
  AnswerAccount,
  AnswerAccountDeclarations,
  RowId,
} from '../../../src/lib/answer-account/types.js';
import type { Recording } from '../../../src/recorders/observability/recordRun.js';
import { assertP1, assertP7, dump, golden } from './helpers.js';

/** The account, with P1 (pointers resolve) and P7 (allow-listed, bounded) asserted on every fixture. */
function explainChecked(
  recording: Recording,
  declarations?: AnswerAccountDeclarations,
  options?: { runId?: string },
): AnswerAccount {
  const account = accountForAnswer(recording, declarations, options);
  assertP1(account, recording, declarations ?? {});
  assertP7(account, recording, declarations ?? {});
  return account;
}

const SCOPE = { conversationId: 'fixture' };

type Built = {
  run: (i: { message: string; identity: typeof SCOPE }) => Promise<unknown>;
  resume: (...a: any[]) => Promise<unknown>;
  on: (t: string, f: (e: AgentfootprintEvent) => void) => unknown;
};

/** The agent's OWN per-run recordings, newest last: `{ recording, runId }`. */
function minted(agent: Built, store: ReturnType<typeof inMemoryArtifacts>) {
  const refs: string[] = [];
  agent.on('agentfootprint.artifacts.minted', (e) => {
    const p = e.payload as { ref?: string; kind?: string };
    if (p.ref !== undefined) refs.push(p.ref);
  });
  return async () => {
    const out: { recording: Recording; runId: string }[] = [];
    for (const ref of refs) {
      const record = await store.get(SCOPE, ref);
      if (record?.meta.kind !== 'recording/run') continue;
      out.push({
        recording: JSON.parse(record.data as string) as Recording,
        runId: record.meta.origin?.runId as string,
      });
    }
    return out;
  };
}

const lookup = (name: string, execute: () => unknown) =>
  defineTool({
    name,
    description: `the ${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute,
  });

const rowText = (a: AnswerAccount, id: RowId) =>
  a.rows.find((r) => r.id === id)!.lines.map((l) => l.text);
const rowIds = (a: AnswerAccount, id: RowId) =>
  a.rows.find((r) => r.id === id)!.lines.map((l) => l.template.id);

async function oneRun(
  build: (store: ReturnType<typeof inMemoryArtifacts>) => Built,
  message = 'what runs on array A1?',
  declarations?: AnswerAccountDeclarations,
): Promise<AnswerAccount> {
  const store = inMemoryArtifacts();
  const agent = build(store);
  const read = minted(agent, store);
  await agent.run({ message, identity: SCOPE });
  const [last] = (await read()).slice(-1);
  if (last === undefined) throw new Error('no recording minted');
  return explainChecked(last.recording, declarations, { runId: last.runId });
}

const volumesTool = (result: unknown) => lookup('powerstore_get_volumes', () => result);
const callOnce = (name: string, id = 'c1') =>
  mock({ replies: [{ toolCalls: [{ id, name, args: {} }] }, { content: 'A1 has no volumes.' }] });

describe('C — this run’s own undeclared empty result', () => {
  const build = (result: unknown) => (store: ReturnType<typeof inMemoryArtifacts>) =>
    Agent.create({
      provider: callOnce('powerstore_get_volumes'),
      model: 'mock',
      artifacts: { store, recordings: true },
    })
      .tool(volumesTool(result))
      .build() as unknown as Built;

  it('a wrapper shape with the app’s `rowsAt`: undeclared-empty-used, tone bad, vouched by the app', async () => {
    const a = await oneRun(build({ volume_count: 0, volumes: [] }), undefined, {
      tools: { powerstore_get_volumes: { rowsAt: 'volumes' } },
    });
    expect(a.signals.map((s) => [s.id, s.tone, s.sentence.source])).toEqual([
      ['undeclared-empty-used', 'bad', 'app'],
    ]);
    expect(a.summary.tone).toBe('bad');
    expect(a.summary.sentence.text).toBe(
      "This answer's powerstore_get_volumes call returned an empty result that did not declare what it searched.",
    );
    expect(rowText(a, 'found')).toEqual([
      'powerstore_get_volumes returned an empty result and did not declare what it searched.',
    ]);
    golden('C.rowsAt.txt', dump(a));
  });

  it('the same shape WITHOUT `rowsAt`: the check cannot run — never a guess', async () => {
    const a = await oneRun(build({ volume_count: 0, volumes: [] }));
    expect(a.signals).toEqual([]);
    expect(rowText(a, 'anything-wrong')).toContain(
      'It cannot be told whether the result of powerstore_get_volumes was empty: its shape is not declared.',
    );
    expect(rowText(a, 'found')).toEqual(['powerstore_get_volumes returned a result.']);
  });

  it('a zero-length top-level array is library-counted', async () => {
    const a = await oneRun(build([]));
    expect(a.signals.map((s) => [s.id, s.sentence.source])).toEqual([
      ['undeclared-empty-used', 'library'],
    ]);
  });

  it('a counted rowset says how many', async () => {
    const a = await oneRun(build([{ id: 'v1' }, { id: 'v2' }]));
    expect(rowText(a, 'found')).toEqual(['powerstore_get_volumes returned 2 items.']);
    expect(a.summary.sentence.text).toBe('Nothing this report looks for turned up in the record.');
    expect(a.summary.tone).toBe('ok');
  });
});

describe('D — an entry-routed skill (REAL run), and the same run with its delivery rewritten (SYNTHETIC)', () => {
  const skill = (id: string, d = `use ${id}`) =>
    defineSkill({ id, description: d, body: `${id} body` });
  const graph = () =>
    skillGraph()
      .entry(skill('vip', 'vip desk'), { match: { keywords: ['vip', 'priority'] } })
      .entry(skill('billing', 'refunds'), {
        match: { intent: 'customer wants a refund', examples: ['refund my order'] },
      })
      .classify(keywordScorer())
      .build();
  const build = (store: ReturnType<typeof inMemoryArtifacts>) =>
    Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 3,
      artifacts: { store, recordings: true },
    })
      .system('You are support.')
      .skillGraph(graph())
      .build() as unknown as Built;

  async function recorded() {
    const store = inMemoryArtifacts();
    const agent = build(store);
    const read = minted(agent, store);
    await agent.run({ message: 'I am a VIP customer', identity: SCOPE });
    return (await read()).slice(-1)[0]!;
  }

  it('REAL — the rule quotes the person’s words, and the skill was given', async () => {
    const { recording, runId } = await recorded();
    const a = explainChecked(recording, undefined, { runId });
    expect(rowText(a, 'understood').slice(0, 2)).toEqual([
      "The library's routing picked the vip skill because one of the app's rules matched your words “VIP”.",
      'The skill was given to the model before it answered.',
    ]);
    expect(a.signals).toEqual([]);
    golden('D.real.txt', dump(a));
  });

  it('SYNTHETIC — delivered as another skill, and refused by the graph: decided-not-delivered, bad', async () => {
    const { recording, runId } = await recorded();
    const events = (
      recording.events as unknown as {
        type: string;
        payload: Record<string, unknown>;
        meta: Record<string, unknown>;
      }[]
    ).map((e) =>
      e.type === 'agentfootprint.context.injected' &&
      e.payload.slot === 'system-prompt' &&
      e.payload.sourceId === 'vip'
        ? { ...e, payload: { ...e.payload, sourceId: 'billing' } }
        : e,
    );
    const routed = events.findIndex((e) => e.type === 'agentfootprint.skill.turn_routed');
    events.splice(routed + 1, 0, {
      type: 'agentfootprint.skill.rejected',
      payload: { requestedId: 'vip', allowed: [], iteration: 1 },
      meta: events[routed]!.meta,
    });
    const a = explainChecked({ ...recording, events } as unknown as Recording, undefined, {
      runId,
    });
    expect(rowIds(a, 'understood')).toEqual([
      'understood.rule.witness',
      'understood.rejected',
      'understood.notDelivered.other',
      'understood.confidence.none',
    ]);
    expect(rowText(a, 'understood')[2]).toBe(
      'The vip skill was not given to the model; it was given the billing skill instead.',
    );
    expect(a.signals.map((s) => [s.id, s.tone])).toEqual([['decided-not-delivered', 'bad']]);
    expect(a.summary.sentence.text).toBe(
      'The vip skill was decided for this question but was not given to the model.',
    );
    golden('D.synthetic.txt', dump(a));
  });

  it('a delivery row missing from a complete-looking record makes the check UNREACHABLE, never a signal', async () => {
    const { recording, runId } = await recorded();
    const events = (
      recording.events as unknown as { type: string; payload: Record<string, unknown> }[]
    ).filter(
      (e) =>
        !(
          e.type === 'agentfootprint.context.injected' &&
          e.payload.slot === 'system-prompt' &&
          e.payload.source === 'skill'
        ),
    );
    const a = explainChecked({ ...recording, events } as unknown as Recording, undefined, {
      runId,
    });
    expect(a.signals).toEqual([]);
    expect(a.unreachable.map((u) => u.check)).toEqual(['decided-delivered']);
    expect(rowIds(a, 'understood')).toContain('understood.delivery.unknown');
  });
});

describe('E — the edge set (§2.10)', () => {
  it('no turn_end (the provider ran out): summary.unfinished', async () => {
    const agent = Agent.create({
      provider: mock({ replies: [{ toolCalls: [{ id: 'c1', name: 'lookup', args: {} }] }] }),
      model: 'mock',
    })
      .tool(lookup('lookup', () => 'x'))
      .build();
    const recorder = recordRun(agent);
    await agent.run({ message: 'go' }).catch(() => undefined);
    const recording = recorder.toRecording();
    recorder.stop();
    const a = explainChecked(JSON.parse(JSON.stringify(recording)) as Recording);
    expect(a.summary.sentence.template.id).toBe('summary.unfinished');
    expect(a.answer.status).toBe('not-recorded');
    golden('E.unfinished.txt', dump(a));
  });

  it('no tool calls, no skill graph, gate off', async () => {
    const a = await oneRun(
      (store) =>
        Agent.create({
          provider: mock({ reply: 'hello' }),
          model: 'mock',
          artifacts: { store, recordings: true },
        }).build() as unknown as Built,
      'hi',
    );
    expect(rowIds(a, 'understood')).toEqual(['understood.notConfigured']);
    expect(rowIds(a, 'checked')).toEqual(['checked.noCalls']);
    expect(rowIds(a, 'not-checked')).toEqual(['notChecked.noCalls']);
    expect(rowIds(a, 'found')).toEqual(['found.noCalls']);
    expect(rowIds(a, 'how-sure')).toEqual(['howSure.standing.none', 'howSure.evidence.off']);
    expect(rowIds(a, 'anything-wrong')).toEqual(['wrong.notApplicable']);
    expect(a.summary.sentence.template.id).toBe('summary.none.notApplicable');
    golden('E.nothing.txt', dump(a));
  });

  it('a failed call', async () => {
    const a = await oneRun(
      (store) =>
        Agent.create({
          provider: callOnce('broken'),
          model: 'mock',
          artifacts: { store, recordings: true },
        })
          .tool(
            lookup('broken', () => {
              throw new Error('down');
            }),
          )
          .build() as unknown as Built,
    );
    expect(rowText(a, 'checked')).toEqual(['It ran broken, and the tool reported an error.']);
    expect(rowText(a, 'found')).toEqual(['broken returned an error, not a result.']);
    expect(rowText(a, 'anything-wrong')[0]).toBe(
      '1 tool call did not run cleanly: 1 failed, 0 refused by a rule, 0 declined by a person, 0 not run.',
    );
  });

  it('a rule-refused call (permission policy → notExecuted)', async () => {
    const checker: PermissionChecker = {
      name: 'tool-deny',
      check: async (req) =>
        req.target === 'danger'
          ? { result: 'deny', rationale: 'no', policyRuleId: 'r1' }
          : { result: 'allow' },
    };
    const a = await oneRun(
      (store) =>
        Agent.create({
          provider: callOnce('danger'),
          model: 'mock',
          permissionChecker: checker,
          artifacts: { store, recordings: true },
        })
          .tool(lookup('danger', () => 'x'))
          .build() as unknown as Built,
    );
    expect(a.facts.calls[0]).toMatchObject({ outcome: 'refused', refusedBy: 'r1' });
    expect(rowText(a, 'checked')).toEqual([
      'It asked to run danger, and a rule named r1 refused it.',
    ]);
    expect(rowText(a, 'found')).toEqual(['danger did not run, so it found nothing.']);
  });

  it('a before-tool middleware deny', async () => {
    const a = await oneRun(
      (store) =>
        Agent.create({
          provider: callOnce('lookup'),
          model: 'mock',
          artifacts: { store, recordings: true },
        })
          .tool(lookup('lookup', () => 'x'))
          .toolMiddleware({ name: 'no-lookups', onToolCall: () => deny('ticket') })
          .build() as unknown as Built,
    );
    expect(rowText(a, 'checked')).toEqual([
      'It asked to run lookup, and a rule named no-lookups refused it.',
    ]);
    expect(JSON.stringify(a)).not.toContain('ticket'); // a decision's `why` is never read
  });

  it('R2-B1 — an AFTER-tool deny: the tool ran, its result was withheld; no refusal, no empty-results judgement', async () => {
    const a = await oneRun(
      (store) =>
        Agent.create({
          provider: callOnce('act'),
          model: 'mock',
          artifacts: { store, recordings: true },
        })
          .tool(lookup('act', () => []))
          .toolMiddleware({ name: 'no-raw-pii', onToolResult: () => deny('not for the model') })
          .build() as unknown as Built,
    );
    expect(a.facts.calls[0]).toMatchObject({
      outcome: 'ran',
      withheldBy: 'no-raw-pii',
      emptiness: 'unknown',
    });
    expect(rowText(a, 'checked')).toEqual(['It ran act. The tool did not say what it checked.']);
    expect(rowText(a, 'found')).toEqual([
      'act ran, but a rule named no-raw-pii withheld its result from the model.',
    ]);
    expect(rowIds(a, 'found')).not.toContain('found.refused');
    expect(a.signals).toEqual([]);
    expect(rowText(a, 'anything-wrong')).toContain(
      '1 result was withheld from the model by a rule after the tool ran.',
    );
  });

  it('modelResult differing from result: emptiness is read from what the MODEL read', async () => {
    const a = await oneRun(
      (store) =>
        Agent.create({
          provider: callOnce('act'),
          model: 'mock',
          artifacts: { store, recordings: true },
        })
          .tool(lookup('act', () => [{ ssn: '123-45-6789' }]))
          .toolMiddleware({ name: 'mask', onToolResult: () => allow([], 'masked') })
          .build() as unknown as Built,
    );
    expect(a.facts.calls[0]).toMatchObject({
      outcome: 'ran',
      view: 'model-result',
      emptiness: 'undeclared-empty',
    });
    expect(JSON.stringify(a)).not.toContain('123-45-6789');
  });

  it('a person-declined call (resumed leg)', async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: callOnce('act'),
      model: 'mock',
      artifacts: { store, recordings: true },
    })
      .tool(lookup('act', () => 'ran'))
      .toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'approve?' }) })
      .build() as unknown as Built;
    const read = minted(agent, store);
    const paused = await agent.run({ message: 'go', identity: SCOPE });
    if (!isAskPause(paused as never)) throw new Error('expected an ask pause');
    await agent.resume(
      (paused as { checkpoint: unknown }).checkpoint,
      checkInDeclined({ by: 'alice', note: 'not this one' }),
    );
    const legs = await read();
    expect(legs).toHaveLength(1); // a paused run mints nothing
    const a = explainChecked(legs[0]!.recording, undefined, { runId: legs[0]!.runId });
    expect(a.run.value?.resumedLeg).toBe(true);
    expect(a.facts.calls[0]).toMatchObject({ outcome: 'declined' });
    expect(rowText(a, 'checked')[0]).toBe('It asked to run act; a person was asked and declined.');
    expect(JSON.stringify(a)).not.toContain('not this one'); // a person's note is never printed
    golden('E.declined.txt', dump(a));
  });

  it('a not-dispatched call (a batch settled on a pause), on the resumed leg', async () => {
    const store = inMemoryArtifacts();
    const tool = (name: string) =>
      lookup(name, () =>
        name === 'second'
          ? requestInput({
              id: 'year',
              question: 'Which year?',
              fields: [{ id: 'year', type: 'number', required: true }],
            })
          : `${name} ran`,
      );
    const agent = Agent.create({
      provider: mock({
        replies: [
          {
            toolCalls: [
              { id: 'c1', name: 'first', args: {} },
              { id: 'c2', name: 'second', args: {} },
              { id: 'c3', name: 'third', args: {} },
            ],
          },
          { content: 'done' },
        ],
      }),
      model: 'mock',
      artifacts: { store, recordings: true },
    })
      .tools(['first', 'second', 'third'].map(tool))
      .build() as unknown as Built;
    const read = minted(agent, store);
    const paused = await agent.run({ message: 'go', identity: SCOPE });
    if (!isInputPause(paused as never)) throw new Error('expected an input pause');
    const p = paused as { checkpoint: unknown; awaitingInput: { requestId: string } };
    await agent.resume(p.checkpoint, {
      requestId: p.awaitingInput.requestId,
      values: { year: 2026 },
    });
    const [leg] = await read();
    const a = explainChecked(leg!.recording, undefined, { runId: leg!.runId });
    const third = a.facts.calls.find((c) => c.toolName === 'third');
    expect(third?.outcome).toBe('not-dispatched');
    expect(rowText(a, 'checked')).toContain('It asked to run third, but the call was not run.');
    golden('F.resumed-batch.txt', dump(a));
  });
});

describe('F — a resumed leg (a tool paused for a person, who answered)', () => {
  async function resumedLeg() {
    const store = inMemoryArtifacts();
    const tool = (name: string) =>
      lookup(name, () =>
        name === 'ask_year'
          ? requestInput({
              id: 'year',
              question: 'Which year?',
              fields: [{ id: 'year', type: 'number', required: true }],
            })
          : `${name} ran`,
      );
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'lookup', args: {} }] },
          { toolCalls: [{ id: 'c2', name: 'ask_year', args: {} }] },
          { content: 'In 2026 the array held 3 volumes.' },
        ],
      }),
      model: 'mock',
      artifacts: { store, recordings: true },
    })
      .tools(['lookup', 'ask_year'].map(tool))
      .build() as unknown as Built;
    const read = minted(agent, store);
    const paused = await agent.run({ message: 'how many volumes last year?', identity: SCOPE });
    if (!isInputPause(paused as never)) throw new Error('expected an input pause');
    const p = paused as { checkpoint: unknown; awaitingInput: { requestId: string } };
    await agent.resume(p.checkpoint, {
      requestId: p.awaitingInput.requestId,
      values: { year: 2026 },
    });
    const [leg] = await read();
    return explainChecked(leg!.recording, undefined, { runId: leg!.runId });
  }

  it('B7 — never "did not run any tools"; before-pause lines; summary.resumed', async () => {
    const a = await resumedLeg();
    expect(a.run.value?.resumedLeg).toBe(true);
    const all = a.rows.flatMap((r) => r.lines.map((l) => l.template.id));
    expect(all).not.toContain('checked.noCalls');
    expect(all).not.toContain('found.noCalls');
    expect(rowIds(a, 'asked')).toEqual(['asked.resumed']);
    expect(rowText(a, 'asked')[0]).toBe(
      'This answer continued after a pause. The message, as the run held it: “how many volumes last year?”',
    );
    expect(rowText(a, 'checked')).toContain(
      'Before the pause it also ran 1 tool (lookup); what those checked is not in this record.',
    );
    expect(rowIds(a, 'understood')).toEqual(['understood.notConfigured']);
    expect(rowIds(a, 'anything-wrong')).toContain('wrong.beforePause');
    expect(a.summary.sentence.template.id).toBe('summary.resumed');
    golden('F.resumed.txt', dump(a));
  });
});

describe('G — a quoted turn: an input middleware rewrote the message', () => {
  it('B2 — asked.rewritten (app) + asked.raw.notRecorded; the raw words are never reconstructed', async () => {
    const a = await oneRun(
      (store) =>
        Agent.create({
          provider: mock({ replies: ['answered'] }),
          model: 'mock',
          artifacts: { store, recordings: true },
        })
          .messageMiddleware({
            name: 'be-quoted-line',
            onMessage: (msg: { content: string }) =>
              allow(`> the quoted line\n\n${msg.content}`, 'quoted the line'),
          })
          .build() as unknown as Built,
      'why is this line red?',
    );
    expect(rowIds(a, 'asked')).toEqual(['asked.rewritten', 'asked.raw.notRecorded']);
    const [line] = a.rows.find((r) => r.id === 'asked')!.lines;
    expect(line!.source).toBe('app');
    expect(line!.text).toBe(
      'Your message, as the app passed it to the model: “> the quoted line\n\nwhy is this line red?”',
    );
    expect(a.question.source).toBe('app');
    golden('G.quoted.txt', dump(a));
  });
});
