import { describe, expect, it } from 'vitest';
import { bearer } from '../../../src/identity.js';
import { Agent, allow, ask, checkInApproved, isPaused } from '../../../src/index.js';
import { mock } from '../../../src/providers.js';
import { pausedRequest } from '../../helpers/pausedRequest.js';
import { callThen, checkerOf, composing, events, rows, target } from './fixtures/innerCalls.js';

describe('composed calls after native consent', () => {
  it.each(['check-in', 'middleware', 'credential'] as const)(
    'asks permission for the inner call after the %s door',
    async (door) => {
      const sample = target('sample');
      const compose = composing(async (call) => call('sample', { account: 'fixture' }));
      const outer = {
        ...compose.tool,
        ...(door === 'check-in' && { checkIn: 'always' as const }),
        ...(door === 'credential' && { needs: { credential: 'sample' } }),
      };
      const checker = checkerOf(() => ({ result: 'allow' }));
      let credentialReady = false;
      const agent = Agent.create({
        provider: mock({ replies: callThen() }),
        model: 'fixture',
        permissionChecker: checker,
        ...(door === 'credential' && {
          credentials: {
            id: 'fixture-credentials',
            getCredential: async () =>
              credentialReady
                ? { status: 'issued' as const, credential: bearer('synthetic-test-credential') }
                : {
                    status: 'authorization-required' as const,
                    authorizationUrl: 'https://example.invalid/consent',
                    sessionId: 'fixture',
                  },
          },
        }),
      })
        .tools([outer, sample.tool])
        .toolMiddleware({
          name: 'fixture-review',
          onToolCall: (call) =>
            door === 'middleware' && call.toolName === 'compose'
              ? ask({ question: 'Allow this fixture?' })
              : allow(),
        })
        .build();
      const seen = events(agent);
      const paused = await agent.run({ message: 'Run the fixture.' });
      if (!isPaused(paused)) throw new Error('expected the fixture consent pause');
      expect(sample.entered).toHaveLength(0);
      credentialReady = true;
      const answer =
        door === 'credential'
          ? 'Fixture authorized.'
          : checkInApproved({ request: pausedRequest(paused), by: 'fixture' });

      await expect(agent.resume(paused.checkpoint, answer)).resolves.toBe('done');
      expect(sample.entered).toEqual([{ account: 'fixture' }]);
      expect(checker.requests.find((request) => request.target === 'sample')?.context).toEqual({
        account: 'fixture',
      });
      expect(seen.of('permission.check').map((event) => event.payload.toolCallId)).toContain(
        'c1#inner-1',
      );
      expect(rows(agent)).toMatchObject([
        { toolCallId: 'c1#inner-1', toolName: 'sample', entered: true, ended: 'returned' },
      ]);
    },
  );
});
