/**
 * The film quotes the library. This runs the worked example through the linked
 * library and fails when a quoted line drifts, so the page cannot keep saying
 * something the code has stopped saying.
 *
 * Scripted on purpose: this pins what the library prints for a given record, not
 * how a live model behaves.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Agent, absent, defineTool, describedResult } from 'agentfootprint';
import { accountForAnswer, assessAnswer, recordRun } from 'agentfootprint/observe';
import { mock } from 'agentfootprint/providers';
import { CASES, CODE_SECTION, REAL, UNIVERSE } from '../../components/home/stand/copy';
import { runAnswerCheckDemo } from '../../components/demos/answerCheckDemo';
import { ANSWER_CHECK_FIXTURES } from '../../components/demos/answerCheckFixtures';
import { POSTER_QUOTES } from '../../components/features/posterTimeline';
import { buildRouteSet } from '../../lib/doc-ids.mjs';
import { FEATURE_BEATS } from '../../lib/features/beats';

const refundRows = () =>
  defineTool({
    name: 'get_refund',
    description: 'Refund status for an order',
    inputSchema: { type: 'object', properties: {} },
    execute: () => [{ order: 'A-1042', status: 'pending' }],
  });
const refundMarked = () =>
  defineTool({
    name: 'get_refund',
    description: 'Refund status for an order',
    inputSchema: { type: 'object', properties: {} },
    execute: () =>
      describedResult({
        facts: [{ entity: 'A-1042', status: 'pending' }],
        provenance: { source: 'refund-ledger', measuredAt: '2026-01-15T12:00:00Z' },
      }),
  });
const bank = () =>
  defineTool({
    name: 'search_bank',
    description: 'Search bank settlements',
    inputSchema: { type: 'object', properties: {} },
    execute: () =>
      absent({
        what: 'a settlement for this refund',
        checked: [REAL.accountCheckedItem],
        notChecked: [REAL.accountNotCheckedItem],
      }),
  });
const callRefund = { toolCalls: [{ id: 'c1', name: 'get_refund', args: {} }] };
const callBank = { toolCalls: [{ id: 'c2', name: 'search_bank', args: {} }] };
const parser = { parse: (value: unknown) => value };

/** The line the library appends after the answer. */
const lineOf = (text: unknown) => String(text).split('\n\n---\n\n')[1];

test('not sure: a tool declared a gap and nothing matched', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [callRefund, callBank, { content: REAL.answer }] }),
    model: 'mock',
  })
    .tool(refundRows())
    .tool(bank())
    .answerLayer({ standingLine: true })
    .build();
  assert.equal(lineOf(await agent.run({ message: REAL.question })), REAL.notSure);
});

test('consistent: both lines, and each says it is not a verification', async () => {
  const two = Agent.create({
    provider: mock({ replies: [callRefund, { content: CASES.consistent }] }),
    model: 'mock',
  })
    .tool(refundRows())
    .namesAndNumbersFromEvidence()
    .answerLayer({ standingLine: true })
    .build();
  assert.equal(lineOf(await two.run({ message: REAL.question })), REAL.consistent);

  const one = Agent.create({
    provider: mock({ replies: [callRefund, { content: CASES.limit }] }),
    model: 'mock',
  })
    .tool(refundRows())
    .answerLayer({ standingLine: true })
    .build();
  assert.equal(lineOf(await one.run({ message: REAL.question })), REAL.consistentOneCheck);
});

test('the limit: the status is real, the reason is invented, and the gate still passes it', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [callRefund, { content: CASES.limit }] }),
    model: 'mock',
  })
    .tool(refundRows())
    .namesAndNumbersFromEvidence()
    .answerLayer({ standingLine: true })
    .build();
  assert.equal(lineOf(await agent.run({ message: REAL.question })), REAL.consistentOneCheck);
});

test('not assessed: an answer with no tool at all', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [{ content: CASES.notAssessed }] }),
    model: 'mock',
  })
    .answerLayer({ standingLine: true })
    .build();
  assert.equal(lineOf(await agent.run({ message: REAL.question })), REAL.notAssessed);
});

test('invented value: an identifier no tool returned', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [callRefund, { content: CASES.invented }] }),
    model: 'mock',
  })
    .tool(refundRows())
    .namesAndNumbersFromEvidence({ posture: 'assist' })
    .answerLayer({ standingLine: true })
    .build();
  assert.equal(lineOf(await agent.run({ message: REAL.question })), REAL.invented);
});

test('contradiction: the finding, then withheld, with no re-ask and nothing streamed', async () => {
  let calls = 0;
  const provider = mock({
    respond() {
      calls += 1;
      return calls === 1 ? callRefund : JSON.stringify(CASES.contradicted);
    },
  });
  const agent = Agent.create({ provider, model: 'mock' })
    .tool(refundMarked())
    .outputSchema(parser)
    .claims({ status: { entity: 'A-1042', field: 'status' } })
    .answerValidation({
      id: 'refund',
      version: '1',
      mode: 'enforce',
      agentChecks: ['claims'],
      validate: () => ({ checks: [{ id: 'asked-order', disposition: 'checked-pass' }] }),
    })
    .build();
  const findings: string[] = [];
  let tokens = 0;
  agent.on('agentfootprint.integrity.context_error', (e) => findings.push(String(e.payload.message)));
  agent.on('agentfootprint.stream.token', () => {
    tokens += 1;
  });
  await assert.rejects(agent.run({ message: REAL.question }), (e: Error) => {
    assert.equal(e.message, REAL.withheld);
    return true;
  });
  assert.ok(findings[0]?.startsWith(REAL.finding), `finding changed: ${findings[0]}`);
  assert.equal(calls, 2, 'a contradiction is never re-asked');
  assert.equal(tokens, 0, 'a withheld typed answer streams nothing');
});

test('contradiction, on its own: the answer is delivered and the standing stays not assessed', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [callRefund, { content: JSON.stringify(CASES.contradicted) }] }),
    model: 'mock',
  })
    .tool(refundMarked())
    .outputSchema(parser)
    .claims({ status: { entity: 'A-1042', field: 'status' } })
    .answerLayer()
    .build();
  assert.equal(await agent.run({ message: REAL.question }), JSON.stringify(CASES.contradicted));
  assert.equal((await agent.assessment()).standing, 'not-assessed');
});

test('known: an agreeing typed answer and a check you wrote that passed', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [callRefund, { content: JSON.stringify(CASES.known) }] }),
    model: 'mock',
  })
    .tool(refundMarked())
    .outputSchema(parser)
    .claims({ status: { entity: 'A-1042', field: 'status' } })
    .answerLayer()
    .answerValidation({
      id: 'refund',
      version: '1',
      mode: 'enforce',
      agentChecks: ['claims'],
      validate: () => ({ checks: [{ id: 'asked-order', disposition: 'checked-pass' }] }),
    })
    .build();
  await agent.run({ message: REAL.question });
  assert.equal((await agent.assessment()).standing, 'known');
});

test('an action that never ran: your check reads the run and fails the answer', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [callRefund, { content: JSON.stringify({ order: 'A-1042', action: 'issued' }) }] }),
    model: 'mock',
  })
    .tool(refundRows())
    .tool(
      defineTool({
        name: 'issue_refund',
        description: 'Issue a refund',
        inputSchema: { type: 'object', properties: {} },
        execute: () => 'issued',
      }),
    )
    .outputSchema(parser)
    .answerLayer()
    .answerValidation({
      id: 'refund',
      version: '1',
      mode: 'observe',
      validate: (_answer, context) => ({
        checks: [
          {
            id: 'issue-ran',
            disposition: context.toolCalls.calls.some((call) => call.name === 'issue_refund')
              ? 'checked-pass'
              : 'checked-fail',
          },
        ],
      }),
    })
    .build();
  await agent.run({ message: REAL.question });
  const assessment = await agent.assessment();
  assert.equal(assessment.standing, 'not-sure');
  assert.ok(assessment.reasons.some((reason) => reason.reason === 'answer-check-failed'));
});

test('ask: a value only the person can give pauses before the tool runs', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [{ toolCalls: [{ id: 'c1', name: 'get_refund', args: {} }] }, { content: 'x' }] }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'get_refund',
        description: 'Refund status for an order',
        inputSchema: { type: 'object', required: ['order'], properties: { order: { type: 'string', enum: ['A-1042', 'A-1077'] } } },
        askOrAssume: { order: { ask: REAL.ask, choices: ['A-1042', 'A-1077'] } },
        execute: () => [],
      }),
    )
    .answerLayer()
    .build();
  const paused = (await agent.run({ message: REAL.question })) as unknown as {
    awaitingInput?: { fields?: { description?: string }[] };
  };
  assert.equal(paused.awaitingInput?.fields?.[0]?.description, REAL.ask);
  assert.equal((await agent.assessment()).standing, 'ask');
});

test('explain this answer: the lines shown, its two reasons, and who vouches', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [callRefund, callBank, { content: REAL.answer }] }),
    model: 'mock',
  })
    .tool(refundRows())
    .tool(bank())
    .answerLayer()
    .build();
  const rec = recordRun(agent);
  await agent.run({ message: REAL.question });
  const account = accountForAnswer(JSON.parse(JSON.stringify(rec.toRecording())));
  rec.stop();
  const lines = account.rows.flatMap((row) => row.lines.map((line) => `${line.source}|${line.text}`));
  for (const want of [
    `tool:search_bank|${REAL.accountChecked}`,
    `tool:search_bank|${REAL.accountCheckedItem}`,
    `tool:search_bank|${REAL.accountNotChecked}`,
    `tool:search_bank|${REAL.accountNotCheckedItem}`,
    `tool:search_bank|${REAL.accountFound}`,
    `library|${REAL.accountSure}`,
    `library|${REAL.accountReasonGap}`,
    `library|${REAL.accountReasonEmpty}`,
  ]) {
    assert.ok(lines.includes(want), `missing line: ${want}`);
  }
});

/** Runs a sample exactly as the page shows it, with only its imports supplied. */
const AsyncFunction = (async () => {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<ReturnType<ReturnType<typeof Agent.create>['build']>>;
const runSample = (code: string, scope: Record<string, unknown>) =>
  new AsyncFunction(...Object.keys(scope), `${code.replace(/^import .*$/gm, '')}\nreturn agent;`)(
    ...Object.values(scope),
  );

test('the first code sample prints what the page says the person reads', async () => {
  const sample = CODE_SECTION.samples[0]!;
  const agent = await runSample(sample.code, {
    Agent,
    absent,
    defineTool,
    provider: mock({ replies: [callBank, { content: REAL.answer }] }),
    model: 'mock',
  });
  assert.equal(await agent.run({ message: REAL.question }), sample.output);
});

test('the second code sample throws what the page says it throws', async () => {
  const sample = CODE_SECTION.samples[1]!;
  let tokens = 0;
  const agent = await runSample(sample.code, {
    Agent,
    defineTool,
    describedResult,
    provider: mock({ replies: [callRefund, { content: JSON.stringify(CASES.contradicted) }] }),
    model: 'mock',
    refundAnswer: parser,
    yourOwnCheck: () => ({ checks: [{ id: 'asked-order', disposition: 'checked-pass' }] }),
  });
  agent.on('agentfootprint.stream.token', () => {
    tokens += 1;
  });
  await assert.rejects(agent.run({ message: REAL.question }), (e: Error) => {
    assert.equal(e.message, sample.output);
    return true;
  });
  assert.equal(tokens, 0, 'withheld before anything streams');
});

test('the answer layer adds nothing to what the model is sent', async () => {
  const requests = async (layer: boolean) => {
    const seen: unknown[] = [];
    const provider = mock({
      respond(request) {
        seen.push(JSON.parse(JSON.stringify(request)));
        return seen.length === 1 ? callRefund : { content: CASES.consistent };
      },
    });
    const builder = Agent.create({ provider, model: 'mock' }).system('Answer from the tools.').tool(refundRows());
    const agent = layer ? builder.answerLayer({ standingLine: true }).build() : builder.build();
    await agent.run({ message: REAL.question });
    return seen;
  };
  assert.deepEqual(await requests(true), await requests(false));
});

test('one draft, three outcomes: the check reads the record, so the same words can differ', async () => {
  const drafts = new Set(ANSWER_CHECK_FIXTURES.map((fixture) => JSON.stringify(fixture.draft)));
  assert.equal(drafts.size, 1, 'the demo must keep one draft for this claim to hold');
  const statuses = [];
  for (const fixture of ANSWER_CHECK_FIXTURES) statuses.push((await runAnswerCheckDemo(fixture)).report.status);
  assert.deepEqual(statuses, ['passed', 'unverified', 'failed']);
});

test('built around that record: the same saved run gives the standing and the account', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [callRefund, callBank, { content: REAL.answer }] }),
    model: 'mock',
  })
    .tool(refundRows())
    .tool(bank())
    .answerLayer()
    .build();
  const rec = recordRun(agent);
  await agent.run({ message: REAL.question });
  const live = await agent.assessment();
  const recording = JSON.parse(JSON.stringify(rec.toRecording()));
  rec.stop();
  assert.equal(assessAnswer(recording).standing, live.standing);
  assert.ok(accountForAnswer(recording).rows.length > 0);
});

test('streamed text: the tokens carry the answer, and its standing arrives after them', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [callRefund, callBank, { content: REAL.answer }] }),
    model: 'mock',
  })
    .tool(refundRows())
    .tool(bank())
    .answerLayer({ standingLine: true })
    .build();
  let streamed = '';
  let standing: unknown;
  agent.on('agentfootprint.stream.token', (e) => {
    streamed += String(e.payload.content);
  });
  agent.on('agentfootprint.answer.assessed', (e) => {
    standing = e.payload.standing;
  });
  const result = await agent.run({ message: REAL.question });
  assert.equal(streamed, REAL.answer, 'no standing line among the tokens');
  assert.equal(standing, 'not-sure');
  assert.equal(lineOf(result), REAL.notSure);
});

test('the comparison quotes the library: a clean run says it is not a verification', () => {
  assert.ok(REAL.consistent.endsWith('This is not a verification.'));
  assert.ok(REAL.consistentOneCheck.endsWith('This is not a verification.'));
});

test('the last shot names only real APIs', async () => {
  const doors = await Promise.all([
    import('agentfootprint'),
    import('agentfootprint/context'),
    import('agentfootprint/memory'),
    import('agentfootprint/security'),
  ]);
  const exported = new Set(doors.flatMap((door) => Object.keys(door)));
  for (const source of UNIVERSE.sources) {
    const name = source.api.replace('()', '');
    assert.ok(exported.has(name), `${name} is not exported by any door`);
  }
});

test('prose under rails: both drafts stream, then the run throws', async () => {
  let calls = 0;
  const provider = mock({
    respond() {
      calls += 1;
      return calls === 1 ? callRefund : { content: CASES.invented };
    },
  });
  const agent = Agent.create({ provider, model: 'mock' })
    .tool(refundRows())
    .namesAndNumbersFromEvidence({ posture: 'rails' })
    .answerLayer()
    .build();
  let streamed = '';
  agent.on('agentfootprint.stream.token', (e) => {
    streamed += String(e.payload.content);
  });
  await assert.rejects(agent.run({ message: REAL.question }));
  assert.equal(calls, 3, 'one call for the tool, and two drafts');
  assert.equal(streamed, CASES.invented + CASES.invented);
});

test('the Features posters name real APIs', async () => {
  const doors = await Promise.all([
    import('agentfootprint'),
    import('agentfootprint/providers'),
    import('agentfootprint/resilience'),
  ]);
  const exported = new Set(doors.flatMap((door) => Object.keys(door)));
  for (const name of POSTER_QUOTES.exports) assert.ok(exported.has(name), `${name} is not exported by any door`);
  const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' }).build();
  for (const name of POSTER_QUOTES.methods) {
    assert.equal(typeof (agent as unknown as Record<string, unknown>)[name], 'function', `${name} is not on an agent`);
  }
});

test('WATCH logs the events a run really fires, in that order', async () => {
  let calls = 0;
  const twoTools = {
    content: '',
    toolCalls: [
      { id: 'c1', name: 'search', args: {} },
      { id: 'c2', name: 'read', args: {} },
    ],
  };
  const tool = (name: string) =>
    defineTool({
      name,
      description: name,
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'done',
    });
  const provider = mock({
    respond() {
      calls += 1;
      return calls === 1 ? twoTools : { content: 'The answer.' };
    },
  });
  const agent = Agent.create({ provider, model: 'mock' }).tool(tool('search')).tool(tool('read')).build();
  const fired: string[] = [];
  for (const type of new Set(POSTER_QUOTES.events)) agent.on(type, () => fired.push(type));
  await agent.run({ message: 'go' });
  assert.deepEqual(fired.slice(0, POSTER_QUOTES.events.length), [...POSTER_QUOTES.events]);
});

test('every Read more on Features is a real docs page', () => {
  const routes = buildRouteSet();
  for (const beat of FEATURE_BEATS) {
    assert.ok(routes.has(beat.href), `${beat.id} links to ${beat.href}, which is not a page in content/docs`);
  }
});
