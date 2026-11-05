/**
 * The film quotes the library. This runs the worked example through the linked
 * library and fails when a quoted line drifts, so the page cannot keep saying
 * something the code has stopped saying.
 *
 * Scripted on purpose: this pins what the library prints for a given record, not
 * how a live model behaves.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Agent, LLMCall, absent, defineTool, describedResult, llmSwarm } from 'agentfootprint';
import { accountForAnswer, assessAnswer, recordRun } from 'agentfootprint/observe';
import { mock } from 'agentfootprint/providers';
import {
  PermissionPolicy,
  REDACTED_PLACEHOLDER,
  conversationRedaction,
} from 'agentfootprint/security';
import { CASES, CODE_SECTION, REAL, UNIVERSE } from '../../components/home/stand/copy';
import { LINE } from '../../components/home/stand/timeline';
import { runAnswerCheckDemo } from '../../components/demos/answerCheckDemo';
import { ANSWER_CHECK_FIXTURES } from '../../components/demos/answerCheckFixtures';
import { SCENE_QUOTES } from '../../components/features/sceneQuotes';
import { buildRouteSet } from '../../lib/doc-ids.mjs';
import {
  ADAPTER_PAGES,
  ADAPTER_ROWS,
  SESSION_STORES_PAGE,
  adapterName,
} from '../../lib/features/adapters';
import { FEATURES_ALSO, FEATURE_BEATS } from '../../lib/features/beats';

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
  agent.on('agentfootprint.integrity.context_error', (e) =>
    findings.push(String(e.payload.message)),
  );
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
    provider: mock({
      replies: [callRefund, { content: JSON.stringify({ order: 'A-1042', action: 'issued' }) }],
    }),
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
    provider: mock({
      replies: [{ toolCalls: [{ id: 'c1', name: 'get_refund', args: {} }] }, { content: 'x' }],
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'get_refund',
        description: 'Refund status for an order',
        inputSchema: {
          type: 'object',
          required: ['order'],
          properties: { order: { type: 'string', enum: ['A-1042', 'A-1077'] } },
        },
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
  const lines = account.rows.flatMap((row) =>
    row.lines.map((line) => `${line.source}|${line.text}`),
  );
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
const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (
  ...args: unknown[]
) => Promise<ReturnType<ReturnType<typeof Agent.create>['build']>>;
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
    const builder = Agent.create({ provider, model: 'mock' })
      .system('Answer from the tools.')
      .tool(refundRows());
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
  for (const fixture of ANSWER_CHECK_FIXTURES)
    statuses.push((await runAnswerCheckDemo(fixture)).report.status);
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

const exportedNames = async () => {
  const doors = await Promise.all([
    import('agentfootprint'),
    import('agentfootprint/providers'),
    import('agentfootprint/resilience'),
    import('agentfootprint/observe'),
    import('agentfootprint/security'),
    import('agentfootprint/hosting'),
    import('agentfootprint/memory'),
    import('agentfootprint/context'),
    import('agentfootprint/ag-ui'),
    import('agentfootprint/ontology'),
  ]);
  return new Set(doors.flatMap((door) => Object.keys(door)));
};

const docPage = (page: string) =>
  readFileSync(new URL(`../../content/docs/${page}.mdx`, import.meta.url), 'utf8');

test('the Features scenes name real APIs', async () => {
  const exported = await exportedNames();
  for (const name of SCENE_QUOTES.exports)
    assert.ok(exported.has(name), `${name} is not exported by any door`);
  const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' }).build();
  for (const name of SCENE_QUOTES.methods) {
    assert.equal(
      typeof (agent as unknown as Record<string, unknown>)[name],
      'function',
      `${name} is not on an agent`,
    );
  }
});

/* A name on a Features section is a claim, so each one says what it rests on: real exports, or the docs page that uses the word. */
const KNOWN_AS: Readonly<
  Record<string, { readonly code?: readonly string[]; readonly doc?: readonly [string, RegExp] }>
> = {
  'ReAct loop': { doc: ['getting-started/key-concepts', /ReAct/] },
  'loop engineering': { doc: ['build/loop-moments', /moments of the loop/i] },
  chains: { code: ['Sequence'], doc: ['build/workflow', /chains/i] },
  'routers and supervisors': { code: ['llmRouter', 'llmSwarm'] },
  'multi-agent': { code: ['swarm'], doc: ['getting-started/vs', /multi-agent/i] },
  'structured output': { doc: ['build/tools', /structured output/i] },
  runbookAsTool: { code: ['runbookAsTool'] },
  flowchartAsTool: { code: ['flowchartAsTool'] },
  skills: { code: ['defineSkill'] },
  'SKILL.md files': { code: ['skillsFromDir'] },
  'prompt engineering': { code: ['defineInstruction'] },
  'progressive disclosure': { doc: ['build/skills', /progressive disclosure/i] },
  'context engineering': { doc: ['getting-started/key-concepts', /context engineering/i] },
  'long-term memory': {
    code: ['defineMemory'],
    doc: ['infrastructure/memory-and-stores', /long-term memory/i],
  },
  'episodic and semantic memory': { doc: ['build/memory', /episodic[\s\S]*semantic/i] },
  RAG: { code: ['defineRAG'] },
  ontology: { code: ['defineOntology'] },
  SKOS: { code: ['fromSkos', 'toSkos'] },
  'data references': {
    code: ['inMemoryArtifacts'],
    doc: ['build/artifacts', /refs as tool arguments/],
  },
  'claim check': { doc: ['build/artifacts', /claim-check/] },
  'time awareness': { doc: ['build/time', /run clock/] },
  'model-agnostic': { doc: ['build/custom-provider', /LLMProvider/] },
  Anthropic: { code: ['anthropic'] },
  OpenAI: { code: ['openai'] },
  Azure: { code: ['azureOpenai', 'foundry'] },
  Bedrock: { code: ['bedrock'] },
  Gemini: { code: ['gemini'] },
  Ollama: { code: ['ollama'] },
  'ports and adapters': { doc: ['infrastructure/index', /ports-&-adapters/] },
  'hexagonal architecture': { doc: ['reference/strategy-everywhere', /Hexagonal/] },
  plugins: { doc: ['build/loop-moments', /a plugin, a policy pack/] },
  'bring your own adapter': {
    doc: ['infrastructure/memory-and-stores', /Writing your own adapter/],
  },
  MCP: { code: ['mcpClient', 'mcpServe'] },
  A2A: { code: ['a2aWire'] },
  'behind your LLM gateway': { code: ['invokeModelGateway'] },
  'AG-UI': { code: ['agUi', 'agUiSerializer'] },
  CopilotKit: { doc: ['infrastructure/ag-ui', /CopilotKit/] },
  'frontend tools': { doc: ['infrastructure/ag-ui', /Frontend tools/] },
  streaming: { doc: ['monitor/streaming', /stream/i] },
  observability: { doc: ['monitor/observability', /observability/i] },
  tracing: { code: ['otelObservability', 'xrayObservability'] },
  OpenTelemetry: { code: ['otelObservability'] },
  'custom recorders': { doc: ['monitor/observability', /agent\.attach\(audit\)/] },
  'human-in-the-loop': { code: ['askHuman'], doc: ['monitor/pausable', /human-in-the-loop/i] },
  'tool approval': { code: ['checkInApproved'] },
  'PII redaction': { code: ['conversationRedaction'], doc: ['monitor/security', /personal data/i] },
  'role-based access': { code: ['PermissionPolicy'] },
  'tenant isolation': { doc: ['monitor/security', /multi-tenant identity isolation/i] },
  'audit trail': { code: ['auditExport', 'verifyAuditBundle'] },
  'root-cause analysis': { code: ['localizeContextBug', 'rerunWithoutSources'] },
  'self-explain': { code: ['traceDebugAgent'], doc: ['debug/self-explain', /selfExplain/] },
  replay: { doc: ['debug/offline-replay', /replay/i] },
  'time-travel debugging': { doc: ['debug/time-travel', /time.travel/i] },
  retry: { code: ['withRetry'] },
  fallback: { code: ['withFallback'] },
  'circuit breaker': { code: ['withCircuitBreaker'] },
  checkpointing: { doc: ['monitor/resilience', /checkpoint/i] },
};

test('every name a Features section goes by has something real behind it', async () => {
  const exported = await exportedNames();
  for (const beat of FEATURE_BEATS) {
    for (const { name } of beat.knownAs) {
      const backing = KNOWN_AS[name];
      assert.ok(backing, `"${name}" on ${beat.verb} says nothing about what it rests on`);
      for (const code of backing.code ?? [])
        assert.ok(exported.has(code), `${name}: ${code} is not exported by any door`);
      if (backing.doc)
        assert.match(docPage(backing.doc[0]), backing.doc[1], `${name}: not in ${backing.doc[0]}`);
    }
  }
});

test('the ADAPT table names real adapters and real ports', async () => {
  const exported = await exportedNames();
  const ports = docPage('infrastructure/index');
  for (const row of ADAPTER_ROWS) {
    const cells = [
      ...(row.aws ?? []),
      ...(row.google ?? []),
      ...(row.azure ?? []),
      ...(row.local ?? []),
      ...(row.everywhere ? [row.everywhere] : []),
    ];
    for (const cell of cells)
      assert.ok(
        exported.has(adapterName(cell)),
        `${row.port}: ${adapterName(cell)} is not exported by any door`,
      );
    for (const port of row.yours)
      assert.ok(
        ports.includes(`\`${port}\``),
        `${row.port}: ${port} is not in the docs' list of ports`,
      );
  }
  assert.ok(
    exported.has('runSessionLifecycleConformance'),
    'the table points a session store you write at this',
  );
});

test('PROTECT: the record drops the message, the model still receives it, and a recording keeps the answer', async () => {
  const secret = 'card-4242-4242';
  const answer = 'the-answer-7731';
  const sent: string[] = [];
  const provider = mock({
    respond(request) {
      sent.push(JSON.stringify(request));
      return { content: answer };
    },
  });
  const agent = Agent.create({ provider, model: 'mock', redact: conversationRedaction() }).build();
  const recorder = recordRun(agent);
  await agent.run({ message: `my number is ${secret}` });
  assert.ok(
    sent.some((request) => request.includes(secret)),
    'the page says the model still receives it',
  );
  const snapshot = agent.getLastSnapshot() as unknown as {
    sharedState: Record<string, unknown>;
    executionTree: unknown;
  };
  const recording = JSON.stringify(recorder.toRecording());
  assert.ok(!JSON.stringify(snapshot).includes(secret), 'the page says the record does not');
  assert.ok(!recording.includes(secret), 'nor does a saved recording');
  assert.ok(
    recording.includes(answer),
    'the page says a saved recording still carries the final answer',
  );
  /* Two forms, both by design: the state reads REDACTED, and the steps of the run read [REDACTED], which the scene shows. */
  const [hidden1, hidden2, hidden3, kept] = SCENE_QUOTES.recordKeys;
  for (const key of [hidden1, hidden2, hidden3])
    assert.equal(snapshot.sharedState[key], 'REDACTED', `${key} should read as redacted`);
  assert.ok(JSON.stringify(snapshot.executionTree).includes(REDACTED_PLACEHOLDER));
  assert.equal(typeof snapshot.sharedState[kept], 'number', `${kept} should stay readable`);
});

test('PROTECT: a role without the tool is refused, and the tool does not run', async () => {
  let ran = 0;
  let calls = 0;
  const refund = defineTool({
    name: 'process_refund',
    description: 'refund',
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      ran += 1;
      return 'done';
    },
  });
  const provider = mock({
    respond() {
      calls += 1;
      return calls === 1
        ? { content: '', toolCalls: [{ id: 'c1', name: 'process_refund', args: {} }] }
        : { content: 'I cannot do that.' };
    },
  });
  const policy = PermissionPolicy.fromRoles(
    { readonly: ['lookup_order'], support: ['lookup_order', 'process_refund'] },
    'readonly',
  );
  const agent = Agent.create({ provider, model: 'mock', permissionChecker: policy })
    .tool(refund)
    .build();
  const results: unknown[] = [];
  agent.on('agentfootprint.permission.check', (event) => results.push(event.payload.result));
  await agent.run({ message: 'refund it' });
  assert.equal(ran, 0);
  assert.ok(results.includes('deny'), 'the scene shows this call refused');
});

test('BUILD: a router picks a specialist, is asked again, and finishes', async () => {
  let routerCalls = 0;
  let specialistCalls = 0;
  const billing = LLMCall.create({
    provider: mock({
      respond() {
        specialistCalls += 1;
        return { content: '[billing] refund approved' };
      },
    }),
    model: 'mock',
  })
    .system('billing')
    .build();
  const router = mock({
    respond() {
      routerCalls += 1;
      return {
        content: JSON.stringify(
          routerCalls === 1
            ? { agentId: 'billing', message: 'handle this' }
            : { message: 'All done.' },
        ),
      };
    },
  });
  const tech = LLMCall.create({ provider: mock({ reply: '[tech] ok' }), model: 'mock' })
    .system('tech')
    .build();
  const desk = llmSwarm({
    provider: router,
    model: 'mock',
    agents: [
      { id: 'billing', description: 'billing questions', runner: billing },
      { id: 'tech', description: 'technical questions', runner: tech },
    ],
  });
  assert.equal(await desk.run({ message: 'my invoice is wrong' }), 'All done.');
  assert.equal(specialistCalls, 1);
  assert.equal(routerCalls, 2, 'this is why the page can say supervisor');
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
  const agent = Agent.create({ provider, model: 'mock' })
    .tool(tool('search'))
    .tool(tool('read'))
    .build();
  const fired: string[] = [];
  for (const type of new Set(SCENE_QUOTES.events)) agent.on(type, () => fired.push(type));
  await agent.run({ message: 'go' });
  assert.deepEqual(fired.slice(0, SCENE_QUOTES.events.length), [...SCENE_QUOTES.events]);
});

/* A site page or a docs page, whichever the link says. */
const assertRealLink = (routes: Set<string>, href: string) => {
  const path = href.split('#')[0]!;
  if (path.startsWith('/docs'))
    assert.ok(routes.has(path), `${href} is not a page in content/docs`);
  else
    assert.ok(
      existsSync(new URL(`../../app/(home)${path}/page.tsx`, import.meta.url)),
      `${href} is not a page on the site`,
    );
};

test('every link on Features goes to a real page', () => {
  const routes = buildRouteSet();
  const tags = FEATURE_BEATS.flatMap((beat) => beat.knownAs);
  for (const { href } of [
    ...FEATURE_BEATS,
    ...tags,
    ...FEATURES_ALSO,
    ...ADAPTER_PAGES,
    { href: SESSION_STORES_PAGE },
  ])
    assertRealLink(routes, href);
});

test('SHOW names AG-UI events a run really produces, in that order', async () => {
  const { agUiSerializer } = await import('agentfootprint/ag-ui');
  let calls = 0;
  const provider = mock({
    respond() {
      calls += 1;
      return calls === 1
        ? { content: '', toolCalls: [{ id: 'c1', name: 'get_refund', args: {} }] }
        : { content: 'Still pending.' };
    },
  });
  const tool = defineTool({
    name: 'get_refund',
    description: 'look up',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'pending',
  });
  const agent = Agent.create({ provider, model: 'mock' }).tool(tool).build();
  const serializer = agUiSerializer({ threadId: 't1', runId: 'r1' });
  const types: string[] = [];
  agent.on('*', (event) => {
    for (const out of serializer.event(event)) types.push(String(out.type));
  });
  await agent.run({ message: 'go' });
  for (const out of serializer.settle({ kind: 'finished' })) types.push(String(out.type));
  const positions = SCENE_QUOTES.agUi.map((name) => types.indexOf(name));
  assert.ok(
    positions.every((at) => at >= 0),
    `missing from ${types.join(' ')}`,
  );
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
    `out of order in ${types.join(' ')}`,
  );
});

test('the line that heads the film is the page title, and every word has a part to light for', () => {
  assert.equal(LINE.map(({ text }) => text).join(' '), 'Build agents you can hold to the record.');
  const film = readFileSync(
    new URL('../../components/home/stand/StandFilm.tsx', import.meta.url),
    'utf8',
  );
  assert.match(film, /Build agents you can <em>hold to the record\.<\/em>/);
  for (const { text, on } of LINE) assert.ok(on.length > 0, text);
});
