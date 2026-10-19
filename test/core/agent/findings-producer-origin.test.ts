/** The producer's entry fact survives teaching notices, checkpoints and resume. */
import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  ask,
  checkInApproved,
  checkInDeclined,
  defineTool,
  isPaused,
  pauseHere,
  requestInput,
} from '../../../src/index.js';
import { memorySessions, standingAgent } from '../../../src/hosting/index.js';
import { filingHost } from '../../hosting/turnArtifactsHarness.js';
import { mock } from '../../../src/providers.js';
import * as timeLayer from '../../../src/core/agent/stages/timeLayer.js';
import { allow, deny } from '../../../src/core/agent/middleware/outcomes.js';
import type { AgentState } from '../../../src/core/agent/types.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';

const previous = { previous: [{ toolCallId: 'c1', standing: 'fact' }] };
const call = (id: string, args: Record<string, unknown> = { q: id }) => ({
  content: '',
  toolCalls: [{ id, name: 'read', args }],
});
const state = (agent: Agent) => agent.getLastSnapshot()?.sharedState as unknown as AgentState;
const witness = (agent: Agent) =>
  state(agent).findingsRequest?.[0]?.results.find((entry) => entry.toolCallId === 'c1');
const readTool = (execute: (args: { q: string }) => unknown) =>
  defineTool({
    name: 'read',
    description: 'Synthetic read',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    execute,
  });

function producerFixture(kind: string, findings = true) {
  const requests: LLMRequest[] = [];
  let at = 0;
  const execute = vi.fn((args: { q: string }) => {
    if (kind === 'executed-error' && args.q === 'c1') throw Error('synthetic execute error');
    // A cache inside the tool boundary still supplies a tool result. No fresh
    // backend access is implied by accepting its identity as result evidence.
    return kind === 'cached-result' ? 'cached rows' : 'rows';
  });
  const builder = Agent.create({
    model: 'mock',
    provider: mock({
      respond: (request) => {
        requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
        if (++at === 1)
          return call('c1', {
            q: kind === 'invalid-arguments' ? 123 : 'c1',
            ...(kind === 'findings-refusal' && {
              _findings: { previous: [{ toolCallId: 'ghost', standing: 'fact' }] },
            }),
          });
        return at === 2 ? call('c2', { q: 'c2', _findings: previous }) : 'done';
      },
    }),
    permissionChecker: {
      check: (request) => ({
        result:
          kind === 'permission-denial' &&
          request.capability === 'tool_call' &&
          request.context?.q === 'c1'
            ? 'deny'
            : 'allow',
      }),
    },
  })
    .tool(readTool(execute))
    .toolMiddleware({
      name: 'fixture',
      onToolCall: (context) =>
        kind === 'middleware-denial' && context.args.q === 'c1'
          ? deny('synthetic denial')
          : allow(),
    });
  return { agent: (findings ? builder.findings() : builder).build(), execute, requests };
}

describe('findings producer-owned execution origin', () => {
  for (const kind of [
    'findings-refusal',
    'permission-denial',
    'invalid-arguments',
    'middleware-denial',
    'executed-result',
    'executed-error',
    'cached-result',
  ]) {
    it(`${kind}: preserves entry provenance without reading the result text`, async () => {
      const f = producerFixture(kind);
      await f.agent.run({ message: 'read' });
      const refused =
        kind.endsWith('refusal') || kind.endsWith('denial') || kind === 'invalid-arguments';
      expect(f.execute).toHaveBeenCalledTimes(refused ? 0 : 2);
      expect(witness(f.agent)).toMatchObject({
        identified: true,
        execution: refused ? 'not-dispatched' : 'result',
      });
      const first = state(f.agent).history.find((m) => m.role === 'tool' && m.toolCallId === 'c1');
      expect(first).not.toHaveProperty('notDispatched'); // no fabricated paused sibling
      if (refused) {
        expect(first).toHaveProperty('toolResultOrigin', 'not-entered');
        expect(state(f.agent).findingsLedger).toContainEqual(
          expect.objectContaining({ kind: 'standing', toolCallId: 'c1', unknownId: true }),
        );
      } else expect(first).not.toHaveProperty('toolResultOrigin');
      for (const request of f.requests)
        for (const message of request.messages)
          expect(message).not.toHaveProperty('toolResultOrigin');
    });
  }

  it('unarmed refusal records do not gain the findings-only origin field', async () => {
    const f = producerFixture('permission-denial', false);
    await f.agent.run({ message: 'read' });
    for (const message of state(f.agent).history)
      expect(message).not.toHaveProperty('toolResultOrigin');
  });

  for (const resume of ['continue', 'error-resume'] as const) {
    it(`${resume}: serialized history retains known non-entry on a fresh request`, async () => {
      const first = producerFixture('permission-denial');
      await first.agent.run({ message: 'first' });
      const checkpoint = JSON.parse(JSON.stringify(first.agent.checkpoint()!));
      const execute = vi.fn(() => 'rows');
      let at = 0;
      const next = Agent.create({
        model: 'mock',
        provider: mock({
          respond: () => (++at === 1 ? call('c3', { q: 'c3', _findings: previous }) : 'done'),
        }),
      })
        .tool(readTool(execute))
        .findings()
        .build();
      if (resume === 'continue') await next.run({ message: 'continue', continueFrom: checkpoint });
      else await next.resumeOnError(checkpoint);
      expect(execute).not.toHaveBeenCalled();
      expect(witness(next)).toMatchObject({ identified: true, execution: 'not-dispatched' });
    });
  }

  for (const approved of [false, true]) {
    it(`middleware ask resume, approved=${approved}: distinguishes consent from tool entry`, async () => {
      const execute = vi.fn(() => 'rows');
      let at = 0;
      const agent = Agent.create({
        model: 'mock',
        provider: mock({
          respond: () =>
            ++at === 1
              ? call('c1')
              : at === 2
              ? call('c2', { q: 'c2', _findings: previous })
              : 'done',
        }),
      })
        .tool(readTool(execute))
        .toolMiddleware({
          name: 'ask once',
          onToolCall: (context) =>
            context.args.q === 'c1' ? ask({ question: 'Proceed?' }) : allow(),
        })
        .findings()
        .build();
      const paused = await agent.run({ message: 'read' });
      if (!isPaused(paused)) throw Error('expected pause');
      await agent.resume(
        paused.checkpoint,
        approved ? checkInApproved({ by: 'fixture' }) : checkInDeclined({ by: 'fixture' }),
      );
      expect(execute).toHaveBeenCalledTimes(approved ? 2 : 0);
      expect(witness(agent)).toMatchObject({ execution: approved ? 'result' : 'not-dispatched' });
    });
  }

  it('a human answer completes a tool that entered and paused; it remains result evidence', async () => {
    let at = 0;
    const execute = vi.fn((args: { q: string }) => {
      if (args.q === 'c1') pauseHere({ question: 'What rows?' });
      return 'rows';
    });
    const agent = Agent.create({
      model: 'mock',
      provider: mock({
        respond: () =>
          ++at === 1
            ? call('c1')
            : at === 2
            ? call('c2', { q: 'c2', _findings: previous })
            : 'done',
      }),
    })
      .tool(readTool(execute))
      .findings()
      .build();
    const paused = await agent.run({ message: 'read' });
    if (!isPaused(paused)) throw Error('expected pause');
    await agent.resume(paused.checkpoint, 'human rows');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(witness(agent)).toMatchObject({ execution: 'result' });
  });
});

for (const findings of [true, false]) {
  it(`hosted input cancellation retains a notice, never claims no entry (findings=${findings})`, async () => {
    let at = 0;
    const execute = vi.fn((args: { q: string }) => {
      if (args.q === 'c1')
        requestInput({ id: 'fields', question: 'Year?', fields: [{ id: 'year', type: 'number' }] });
      return 'rows';
    });
    const builder = Agent.create({
      model: 'mock',
      provider: mock({
        respond: () =>
          ++at === 1
            ? call('c1')
            : at === 2
            ? call('c2', { q: 'c2', _findings: previous })
            : 'done',
      }),
    }).tool(readTool(execute));
    const agent = (findings ? builder.findings() : builder).build();
    const host = filingHost({ hook: false });
    const serving = await standingAgent({ agent, sessions: memorySessions(), host });
    try {
      const paused = await host.deliver({ input: 'read', sessionId: 'fixture' });
      const requestId = paused.awaiting!.awaitingInput!.requestId;
      const cancelled = await host.deliver({
        sessionId: 'fixture',
        decision: { requestId, cancel: true },
      });
      expect(cancelled.output).toBe('Input request cancelled.');
      expect(at).toBe(1);
      const final = await host.deliver({ input: 'continue', sessionId: 'fixture' });
      expect(final.error).toBeUndefined();
      expect(execute).toHaveBeenCalledTimes(findings ? 1 : 2);
      const message = state(agent).history.find((m) => m.role === 'tool' && m.toolCallId === 'c1');
      if (findings) {
        expect(message).toHaveProperty('toolResultOrigin', 'input-cancelled');
        expect(witness(agent)).toMatchObject({
          identified: true,
          execution: 'unknown',
          reason: 'not-a-result',
        });
      } else expect(message).not.toHaveProperty('toolResultOrigin');
    } finally {
      await serving.close();
    }
  });
}

for (const findings of [true, false]) {
  it(`pre-entry resume preparation is not tool entry (findings=${findings})`, async () => {
    const execute = vi.fn(() => 'rows');
    const after = vi.fn(() => allow());
    let at = 0;
    const builder = Agent.create({
      model: 'mock',
      provider: mock({
        respond: () =>
          ++at === 1
            ? call('c1')
            : at === 2
            ? call('c2', { q: 'c2', _findings: previous })
            : 'done',
      }),
    })
      .tool(readTool(execute))
      .toolMiddleware({
        name: 'ask once',
        onToolCall: (context) =>
          context.args.q === 'c1' ? ask({ question: 'Proceed?' }) : allow(),
        onToolResult: after,
      })
      .time({ zone: 'UTC' });
    const agent = (findings ? builder.findings() : builder).build();
    const paused = await agent.run({ message: 'read', time: { now: '2026-10-19T12:00:00Z' } });
    if (!isPaused(paused)) throw Error('expected pause');
    const preparation = vi.spyOn(timeLayer, 'timeAtDispatch').mockImplementationOnce(() => {
      throw Error('synthetic pre-entry preparation failure');
    });
    try {
      await agent.resume(paused.checkpoint, checkInApproved({ by: 'fixture' }));
      expect(execute).toHaveBeenCalledTimes(findings ? 0 : 1);
      expect(after).toHaveBeenCalledTimes(findings ? 0 : 1);
      if (findings) expect(witness(agent)).toMatchObject({ execution: 'not-dispatched' });
      else
        expect(state(agent).history.find((m) => m.toolCallId === 'c1')).not.toHaveProperty(
          'toolResultOrigin',
        );
    } finally {
      preparation.mockRestore();
    }
  });
}

for (const approved of [false, true]) {
  it(`check-in resume, approved=${approved}: uses actual entry, not clean-success eligibility`, async () => {
    const execute = vi.fn((args: { q: string }) => {
      if (args.q === 'c1') throw Error('synthetic entered error');
      return 'rows';
    });
    let at = 0;
    const agent = Agent.create({
      model: 'mock',
      provider: mock({
        respond: () =>
          ++at === 1
            ? call('c1')
            : at === 2
            ? call('c2', { q: 'c2', _findings: previous })
            : 'done',
      }),
    })
      .tool({ ...readTool(execute), checkIn: (args) => args.q === 'c1' })
      .checkIn({ evidence: 'minimal' })
      .findings()
      .build();
    const paused = await agent.run({ message: 'read' });
    if (!isPaused(paused)) throw Error('expected pause');
    await agent.resume(
      paused.checkpoint,
      approved ? checkInApproved({ by: 'fixture' }) : checkInDeclined({ by: 'fixture' }),
    );
    expect(execute).toHaveBeenCalledTimes(approved ? 2 : 0);
    expect(witness(agent)).toMatchObject({ execution: approved ? 'result' : 'not-dispatched' });
  });
}
