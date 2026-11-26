import { describe, expect, it } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';
import { Agent, allow, codeRunnerTool, defineTool } from '../../../../src/index.js';
import { assessAnswer, recordRun } from '../../../../src/observe.js';
import { mock } from '../../../../src/providers.js';
import type { CodeResult, LLMProvider } from '../../../../src/provider-contract/types.js';

const program = 'print("unshared program text", 2 + 2)';
const runCode = {
  toolCalls: [{ id: 'reused', name: 'run_code', args: { code: program } }],
};
const claimedRun = { content: 'I ran code.' };
const claimedEstimate = { content: 'I only estimated, without running code.' };
const neutral = { content: 'The result is ready.' };
const successfulExit: CodeResult = { ok: true, exitCode: 0, stdout: '4', stderr: '' };

function build(
  replies: readonly unknown[],
  options: {
    exit?: CodeResult;
    commitValues?: 'full' | 'delta';
    redact?: RedactionPolicy;
    provider?: LLMProvider;
  } = {},
) {
  return Agent.create({
    provider: options.provider ?? mock({ replies: [...replies] as never }),
    model: 'mock',
    commitValues: options.commitValues ?? 'delta',
    ...(options.redact !== undefined && { redact: options.redact }),
  }).tool(
    codeRunnerTool({
      runner: {
        id: 'answering',
        start: async () => ({
          id: 'session',
          execute: async () => options.exit ?? successfulExit,
          stop: async () => undefined,
        }),
      },
    }),
  );
}

function saved(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

const facts = (agent: Agent) => agent.getLastSnapshot()?.sharedState?.answerExecutionClaims;

describe('receipt check on a native recorded answer', () => {
  it.each(['full', 'delta'] as const)(
    'matches a confirmed exit across %s live and saved',
    async (commitValues) => {
      const agent = build([runCode, claimedRun], { commitValues }).answerLayer().build();
      const recorder = recordRun(agent);
      await agent.run({ message: 'Compute this.' });
      expect(facts(agent)).toMatchObject({
        complete: true,
        findings: [
          {
            claim: 'ran-code',
            target: 'current',
            outcome: 'verified',
            callOccurrenceKey: [
              expect.any(Number),
              expect.any(Number),
              expect.any(Number),
              expect.any(Number),
              0,
            ],
          },
        ],
      });
      expect(JSON.stringify(facts(agent))).not.toContain(program);
      expect(await agent.assessment()).toEqual(assessAnswer(saved(recorder.toRecording())));
      recorder.stop();
    },
  );

  it('records a contradiction over a complete no-dispatch turn', async () => {
    const agent = build([claimedRun]).answerLayer().build();
    await agent.run({ message: 'Did you run code?' });
    expect(facts(agent)).toMatchObject({
      findings: [{ claim: 'ran-code', target: 'current', outcome: 'contradicted' }],
    });
    expect((await agent.assessment())?.reasons.map((row) => row.reason)).toContain(
      'unsupported-claim',
    );
  });

  it('accepts an exclusive estimate claim for the complete no-execution case', async () => {
    const agent = build([claimedEstimate]).build();
    await agent.run({ message: 'Did you run code or estimate?' });
    expect(facts(agent)).toMatchObject({
      findings: [{ claim: 'no-code', target: 'current', outcome: 'verified' }],
    });
  });

  it('keeps a settled nonzero exit distinct from unknown execution', async () => {
    const failed = build([runCode, claimedEstimate], {
      exit: { ok: false, exitCode: 7, stdout: '', stderr: 'program failed' },
    }).build();
    await failed.run({ message: 'Did you run code or estimate?' });
    expect(facts(failed)).toMatchObject({
      findings: [{ claim: 'no-code', target: 'current', outcome: 'contradicted' }],
    });

    const reported = build([runCode, claimedRun], {
      exit: { ok: true, stdout: '4', stderr: '' },
    }).build();
    await reported.run({ message: 'Did you run code?' });
    expect(facts(reported)).toMatchObject({
      findings: [{ claim: 'ran-code', target: 'current', outcome: 'unverified' }],
    });
  });

  it('does not infer absence from a provider with an opaque execution path', async () => {
    const adapter = mock({ replies: [claimedRun] });
    const provider = { name: adapter.name, complete: adapter.complete.bind(adapter) };
    const agent = build([], { provider }).build();
    await agent.run({ message: 'Did you run code?' });
    expect(facts(agent)).toMatchObject({ findings: [{ outcome: 'unverified' }] });
  });

  it('checks the accepted prose after output middleware revises it', async () => {
    const agent = build([claimedRun])
      .messageMiddleware({
        name: 'accepted answer rewrite',
        onMessage: ({ phase }) =>
          phase === 'output'
            ? allow(claimedEstimate.content, 'Use the final estimate wording.')
            : allow(),
      })
      .build();
    expect(await agent.run({ message: 'Did you run code or estimate?' })).toBe(
      claimedEstimate.content,
    );
    expect(facts(agent)).toMatchObject({ findings: [{ claim: 'no-code', outcome: 'verified' }] });
  });

  it('does not infer absence after an opaque tool ran', async () => {
    const tool = defineTool({
      name: 'opaque',
      description: 'Perform work.',
      inputSchema: { type: 'object' },
      execute: () => 'Tool returned.',
    });
    const agent = build([{ toolCalls: [{ id: 'opaque', name: 'opaque', args: {} }] }, claimedRun])
      .tool(tool)
      .build();
    await agent.run({ message: 'Did you run code?' });
    expect(facts(agent)).toMatchObject({
      findings: [{ claim: 'ran-code', target: 'current', outcome: 'unverified' }],
    });
  });

  it.each([true, false])(
    'uses the exact prior checkpoint when its answer ran code is %s',
    async (previousRan) => {
      const previous = build(previousRan ? [runCode, neutral] : [neutral]).build();
      await previous.run({ message: 'Compute this.' });
      const prior = saved(previous.checkpoint());
      expect(prior.completedCodeExecution?.originRunId).toBe(prior.runId);
      const follow = build(previousRan ? [claimedEstimate] : [runCode, claimedEstimate]).build();
      await follow.run({
        message: 'Did you run code or estimate for the previous answer?',
        continueFrom: prior,
      });
      expect(facts(follow)).toMatchObject({
        findings: [
          {
            claim: 'no-code',
            target: 'previous',
            outcome: previousRan ? 'contradicted' : 'verified',
          },
        ],
      });
    },
  );

  it('cannot verify the previous answer from a checkpoint whose receipt belongs to another run', async () => {
    const previous = build([runCode, neutral]).build();
    await previous.run({ message: 'Compute this.' });
    const checkpoint = saved(previous.checkpoint());
    checkpoint.completedCodeExecution.originRunId = 'foreign-run';
    const follow = build([claimedEstimate]).build();
    await follow.run({
      message: 'Did you run code or estimate for the previous answer?',
      continueFrom: checkpoint,
    });
    expect(facts(follow)).toMatchObject({
      findings: [{ claim: 'no-code', target: 'previous', outcome: 'unverified' }],
    });
  });

  it('does not treat a composed follow-up as a human turn', async () => {
    const previous = build([runCode, neutral]).build();
    await previous.run({ message: 'Compute this.' });
    const follow = build([claimedEstimate]).build();
    await follow.run({
      message: 'Did you run code or estimate for the previous answer?',
      messageFrom: 'composed',
      continueFrom: saved(previous.checkpoint()),
    });
    expect(facts(follow)).toBeUndefined();
  });

  it('does not restore a previous receipt under a different conversation identity', async () => {
    const previous = build([runCode, neutral]).build();
    await previous.run({ message: 'Compute this.', identity: { conversationId: 'first' } });
    const follow = build([claimedEstimate]).build();
    await follow.run({
      message: 'Did you run code or estimate for the previous answer?',
      identity: { conversationId: 'different' },
      continueFrom: saved(previous.checkpoint()),
    });
    expect(facts(follow)).toMatchObject({
      findings: [{ target: 'previous', outcome: 'unverified' }],
    });
  });

  it('does not expose an execution or completeness difference when the receipts are kept out', async () => {
    const pair: unknown[] = [];
    for (const replies of [[runCode, claimedEstimate], [claimedEstimate]]) {
      const agent = build(replies, {
        redact: { keys: ['codeExecutionReceipt'] },
      })
        .answerLayer()
        .build();
      const recorder = recordRun(agent);
      await agent.run({ message: 'Did you run code or estimate?' });
      const live = await agent.assessment();
      const reopened = assessAnswer(saved(recorder.toRecording()));
      expect(reopened).toEqual(live);
      expect(agent.checkpoint()?.completedCodeExecution).toBeUndefined();
      pair.push({
        result: facts(agent),
        standing: live?.standing,
        reasons: live?.reasons
          .filter((row) =>
            row.witness.some((w) => w.kind === 'state' && w.key === 'answerExecutionClaims'),
          )
          .map((row) => row.reason),
      });
      recorder.stop();
    }
    expect(pair[0]).toEqual(pair[1]);
  });
});
