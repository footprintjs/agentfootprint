import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { SHOWN_ARGS } from '../../../src/core/toolShownArgs.js';
import type { AgentRunCheckpoint } from '../../../src/core/runCheckpoint.js';
import { Agent, isPaused, pauseHere, RunCheckpointError } from '../../../src/index.js';
import { mock } from '../../../src/providers.js';
import {
  readEnvelope,
  readPausedRun,
  toEnvelope,
  toPausedEnvelope,
} from '../../../src/hosting/envelope.js';
import { everySurface, servedArtifacts } from '../../redaction/everySurface.js';
import { checkerOf, composing, events, target } from './fixtures/innerCalls.js';

const PRIVATE_SAMPLE = 'fixture-ochre-private-input';
const answerPattern = new RegExp(PRIVATE_SAMPLE);
const initialReply = { toolCalls: [{ id: 'fixture-compose', name: 'compose', args: {} }] };
const laterReply = { toolCalls: [{ id: 'fixture-marker', name: 'marker', args: {} }] };

function starter(path: 'continue' | 'recover' | 'native') {
  const sample = target('swatch');
  const protectedSample = {
    ...sample.tool,
    [SHOWN_ARGS]: (args: Record<string, unknown>) => ({ ...args, account: 'REDACTED' }),
  };
  const compose = composing(async (call) => {
    await call('swatch', { account: PRIVATE_SAMPLE });
    if (path === 'native') pauseHere({ question: 'Continue the example?' });
  });
  const provider = mock({ replies: [initialReply, { content: 'Prepared.' }] });
  const requests: string[] = [];
  const complete = provider.complete.bind(provider);
  const agent = Agent.create({
    model: 'fixture',
    permissionChecker: checkerOf(() => ({ result: 'allow' })),
    provider: {
      ...provider,
      async complete(request, options) {
        requests.push(JSON.stringify(request));
        if (path === 'recover' && requests.length > 1) throw new Error('Fixture provider stopped.');
        return complete(request, options);
      },
    },
  })
    .tools([protectedSample, compose.tool])
    .build();
  return { agent, requests };
}

function verifier() {
  const marker = target('marker');
  const checker = checkerOf(() => ({ result: 'allow' }));
  const provider = mock({ replies: [laterReply, { content: 'Finished.' }] });
  const requests: string[] = [];
  const complete = provider.complete.bind(provider);
  const agent = Agent.create({
    model: 'fixture',
    permissionChecker: checker,
    provider: {
      ...provider,
      async complete(request, options) {
        requests.push(JSON.stringify(request));
        return complete(request, options);
      },
    },
  })
    .tool(marker.tool)
    .build();
  return { agent, marker, checker, requests };
}

describe('the private policy checkpoint for prior composed calls', () => {
  it.each(['continue', 'recover', 'native'] as const)(
    'restores a private input on %s and serves its shown view',
    async (path) => {
      const source = starter(path);
      const next = verifier();
      try {
        let restore: () => ReturnType<Agent['run']>;
        let checkpoint: AgentRunCheckpoint | undefined;
        if (path === 'native') {
          const result = await source.agent.run('Prepare the sample.');
          if (!isPaused(result)) throw new Error('Expected a fixture pause.');
          checkpoint = source.agent.checkpoint();
          if (checkpoint === undefined) throw new Error('Expected a fixture checkpoint.');
          const paused = readPausedRun(
            JSON.parse(
              JSON.stringify(
                toPausedEnvelope({
                  checkpoint: result.checkpoint,
                  conversation: checkpoint,
                  pending: { pauseData: result.pauseData },
                }),
              ),
            ),
          );
          restore = () => next.agent.resume(paused.checkpoint, 'Continue.');
        } else {
          if (path === 'continue') {
            await expect(source.agent.run('Prepare the sample.')).resolves.toBe('Prepared.');
            checkpoint = source.agent.checkpoint();
          } else {
            const error = await source.agent
              .run('Prepare the sample.')
              .catch((reason: unknown) => reason);
            if (!(error instanceof RunCheckpointError))
              throw new Error('Expected a fixture checkpoint.');
            expect(
              [error.message, error.stack, inspect(error), JSON.stringify(error)].join('\n'),
            ).not.toMatch(answerPattern);
            checkpoint = error.checkpoint;
          }
          if (checkpoint === undefined) throw new Error('Expected a fixture checkpoint.');
          const saved = readEnvelope(JSON.parse(JSON.stringify(toEnvelope(checkpoint))));
          restore =
            path === 'continue'
              ? () => next.agent.run({ message: 'Resume the fixture.', continueFrom: saved })
              : () => next.agent.resumeOnError(saved);
        }
        expect(JSON.stringify(checkpoint.history)).not.toMatch(answerPattern);
        expect(JSON.stringify(source.requests)).not.toMatch(answerPattern);
        const observed = await everySurface(next.agent, 'Resume the fixture.', undefined, restore);
        expect(observed.answer).toBe('Finished.');
        expect(next.marker.entered).toEqual([{}]);
        const permission = next.checker.requests.find((request) => request.target === 'marker');
        expect(permission?.sequence?.find((entry) => entry.inner)?.args).toEqual({
          account: PRIVATE_SAMPLE,
        });
        for (const [name, served] of Object.entries({
          ...(await servedArtifacts(observed)),
          provider: next.requests,
          policyHistory: permission?.history,
        })) {
          expect(JSON.stringify(served), name).not.toMatch(answerPattern);
        }
      } finally {
        await source.agent.shutdown();
        await next.agent.shutdown();
      }
    },
  );

  it.each(['continue', 'recover'] as const)(
    'refuses tool admission on %s when the checkpoint has only shown inputs',
    async (path) => {
      const source = starter(path);
      const next = verifier();
      try {
        let saved: AgentRunCheckpoint | undefined;
        if (path === 'recover') {
          const error = await source.agent
            .run('Prepare the sample.')
            .catch((reason: unknown) => reason);
          if (!(error instanceof RunCheckpointError))
            throw new Error('Expected a fixture checkpoint.');
          saved = error.checkpoint;
        } else {
          await source.agent.run('Prepare the sample.');
          saved = source.agent.checkpoint();
        }
        if (saved === undefined) throw new Error('Expected a fixture checkpoint.');
        const { innerCallPolicyArgs, ...historyOnly } = saved;
        expect(innerCallPolicyArgs).toBeDefined();
        const priorFormat = readEnvelope(JSON.parse(JSON.stringify(toEnvelope(historyOnly))));
        const seen = events(next.agent);
        if (path === 'recover') await next.agent.resumeOnError(priorFormat);
        else await next.agent.run({ message: 'Resume the fixture.', continueFrom: priorFormat });
        expect(next.marker.entered).toHaveLength(0);
        expect(next.checker.requests.map((request) => request.target)).not.toContain('marker');
        expect(seen.of('permission.check')).toMatchObject([
          {
            payload: {
              target: 'marker',
              result: 'deny',
              rationale: 'Policy arguments from an earlier inner call are unavailable.',
            },
          },
        ]);
      } finally {
        await source.agent.shutdown();
        await next.agent.shutdown();
      }
    },
  );
});
