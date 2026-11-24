import { expect, it } from 'vitest';
import { run as runExample } from '../../../../examples/features/130-source-not-consulted.js';
import { defineSkill } from '../../../../src/injection-engine.js';
import { PermissionPolicy } from '../../../../src/security/PermissionPolicy.js';
import { mockClassifier } from '../../../../src/classify/mock.js';
import { Agent, defineTool, receiptAt } from '../../../../src/index.js';
import { defineOntology } from '../../../../src/ontology/index.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../../../src/observe.js';
import type { LLMProvider } from '../../../../src/provider-contract/types.js';
import { mock } from '../../../../src/providers.js';

const lookup = (name: string, displayName: string) =>
  defineTool({
    name,
    displayName,
    description: 'Read a measurement.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'Observed.',
  });

async function runCase(options: {
  commitValues?: 'full' | 'delta';
  reactMode?: 'dynamic' | 'dynamic-grouped';
  equivalent?: boolean;
  question?: string;
  wire?: boolean;
  enabled?: boolean;
  receipts?: boolean;
  hiddenSkill?: boolean;
  lateEquivalent?: boolean;
  redact?: boolean;
}) {
  const base = mock({
    replies: [
      { toolCalls: [{ id: 'first', name: 'status', args: {} }] },
      ...(options.lateEquivalent
        ? [{ toolCalls: [{ id: 'later', name: 'backup', args: {} }] }]
        : []),
      { content: 'Request complete.' },
    ],
  });
  const provider: LLMProvider = {
    name: 'fixture',
    async complete(request, hooks) {
      const response = await base.complete(request, hooks);
      return options.wire === false ? { ...response, wireManifest: undefined } : response;
    },
  };
  let picks = 0;
  const classifier = mockClassifier(() => {
    const selected = options.lateEquivalent && picks++ === 1 ? 'backup' : 'status';
    return {
      model: 'fixture',
      latencyMs: 1,
      usage: { inputTokens: 1, outputTokens: 1 },
      answers: {
        tool: { type: 'choice', choice: selected, confidence: 1, probabilities: { [selected]: 1 } },
      },
    };
  });
  const builder = Agent.create({
    provider,
    ...(options.reactMode && { reactMode: options.reactMode }),
    model: 'mock',
    commitValues: options.commitValues ?? 'delta',
    recordReceipt: options.receipts ?? true,
    ...(options.redact && { redact: { keys: ['receipt'] } }),
    ...(options.hiddenSkill !== undefined && {
      permissionChecker: PermissionPolicy.fromRoles(
        { public: ['status', 'archive', 'restricted_lookup'] },
        'public',
        { skills: { public: [] } },
      ),
    }),
  })
    .tools([
      lookup('status', 'service status'),
      lookup('archive', 'the archive'),
      ...(options.lateEquivalent ? [lookup('backup', 'alternate monitor')] : []),
    ])
    .toolChoice({ classifier, serve: { top: 1 } })
    .ontology(
      defineOntology({
        id: 'inventory',
        version: '1',
        nodes: {
          inventory: {
            meaning: 'Stored inventory',
            sources: [
              {
                source: 'catalog',
                via: options.equivalent
                  ? ['archive', 'status']
                  : options.lateEquivalent
                  ? ['archive', 'backup']
                  : options.hiddenSkill
                  ? ['archive', 'restricted_lookup']
                  : ['archive'],
              },
            ],
          },
        },
        sources: { catalog: { meaning: 'Declared inventory source' } },
      }),
    )
    .answerLayer({
      sourceNotConsulted: options.enabled ?? true,
      standingLine: { when: 'not-sure-or-ask' },
    });
  if (options.hiddenSkill)
    builder.skill(
      defineSkill({
        id: 'restricted',
        description: 'Restricted role',
        body: 'Private content',
        tools: [lookup('restricted_lookup', 'private monitor')],
      }),
    );
  const agent = builder.build();
  const recorder = recordRun(agent);
  try {
    const answer = await agent.run({ message: options.question ?? 'Check inventory.' });
    const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
    const saved = assessAnswer(recording);
    expect(await agent.assessment()).toEqual(saved);
    return {
      answer,
      recording,
      reasons: saved.reasons.filter((r) => r.reason === 'source-not-consulted'),
      receipt: receiptAt(recording.snapshot, 1)?.toolSelection,
      omissions: recording.snapshot.sharedState.sourceConsultation?.omissions,
    };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

it.each(['delta', 'full'] as const)(
  'warns about a declared source withheld from the accepted request (%s)',
  async (commitValues) => {
    const result = await runCase({ commitValues });
    expect(result.receipt?.absent).toEqual([{ name: 'archive', reason: 'top-N' }]);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]?.detail).toEqual({ unavailableTools: ['the archive'] });
    expect(result.omissions).toEqual([
      expect.objectContaining({
        selection: {
          iteration: 1,
          consumer: result.receipt?.consumer,
          reason: 'top-N',
          wireName: 'archive',
        },
      }),
    ]);
    expect(result.answer).toContain('the archive');
    expect(result.answer).not.toContain('after it was offered');
  },
);

it.each(['delta', 'full'] as const)(
  'requires the actual accepted selection on replay (%s)',
  async (commitValues) => {
    const { recording, reasons } = await runCase({ commitValues });
    expect(reasons[0]?.detail).toEqual({ unavailableTools: ['the archive'] });
    expect(accountForAnswer(recording).facts.standing.value).toBe('not-sure');
    const check = (alter: (row: typeof recording) => void) => {
      const copy = structuredClone(recording);
      alter(copy);
      expect(accountForAnswer(copy).facts.standing.value).not.toBe('not-sure');
      expect(assessAnswer(copy).reasons.filter((r) => r.reason === 'source-not-consulted')).toEqual(
        [],
      );
    };
    check((r) => {
      r.snapshot.sharedState.sourceConsultation.omissions[0].selection.consumer = {
        series: 'absent-attempt',
        attempt: 999,
      };
    });
    check((r) => {
      r.snapshot.sharedState.sourceConsultation.omissions[0].selection.reason = 'ledger';
    });
    check((r) => {
      r.snapshot.sharedState.sourceConsultation.omissions[0].selection.wireName = 'different-tool';
    });
    check((r) => {
      r.snapshot.sharedState.sourceConsultation.omissions[0].callable = 987;
    });
    check((r) => {
      r.snapshot.sharedState.sourceConsultation.omissions[0].name = 'invented label';
    });
    check((r) => {
      const logs = { commitLog: r.snapshot.commitLog, subflowResults: r.snapshot.subflowResults };
      const stripped = JSON.parse(
        JSON.stringify(logs, (key, value) => (key === 'toolSelection' ? undefined : value)),
      );
      Object.assign(r.snapshot, stripped);
      expect(receiptAt(r.snapshot, 1)?.toolSelection).toBeUndefined();
    });
    check((r) => {
      delete r.snapshot.commitLog;
      delete r.snapshot.subflowResults;
    });
  },
);

it.each(['dynamic', 'dynamic-grouped'] as const)(
  'joins visible omissions to the model call under %s',
  async (reactMode) => {
    const { recording, answer } = await runCase({ reactMode });
    expect(answer).toContain('a request left out the archive');
    expect(
      assessAnswer(recording).reasons.find((r) => r.reason === 'source-not-consulted')?.detail,
    ).toEqual({ unavailableTools: ['the archive'] });
  },
);

it.each([
  { equivalent: true },
  { question: 'What is online?' },
  { wire: false },
  { enabled: false },
  { receipts: false },
  { redact: true },
])('keeps the answer unchanged without a grounded, unconsulted omission %j', async (options) => {
  const result = await runCase(options);
  expect(result.reasons).toEqual([]);
  expect(result.answer).toBe('Request complete.');
});

it('keeps the first request omission and clears the warning after a later equivalent attempt', async () => {
  const result = await runCase({ lateEquivalent: true });
  expect(result.receipt?.absent).toContainEqual({ name: 'archive', reason: 'top-N' });
  expect(result.reasons).toEqual([]);
  expect(result.answer).toBe('Request complete.');
});

it('adding a hidden holder changes no served warning, names or count', async () => {
  const both = await runCase({ hiddenSkill: true });
  const without = await runCase({ hiddenSkill: false });
  expect(both.reasons).toHaveLength(1);
  expect(both.reasons).toEqual(without.reasons);
  expect(both.answer).toBe(without.answer);
  expect(both.receipt?.absent).toEqual(without.receipt?.absent);
});

it('runs the published one-tool example', async () => {
  const result = await runExample('Give me the link observation.', true);
  expect(result.answer).toContain('a request left out link monitor');
});
