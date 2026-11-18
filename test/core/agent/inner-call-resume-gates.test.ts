import { describe, expect, it } from 'vitest';
import { bearer } from '../../../src/identity.js';
import { Agent, allow, ask, checkInApproved, isPaused } from '../../../src/index.js';
import { mock } from '../../../src/providers.js';
import { PolicyHaltError } from '../../../src/security/index.js';
import { pausedRequest } from '../../helpers/pausedRequest.js';
import { callThen, checkerOf, composing, events, rows, target } from './fixtures/innerCalls.js';

describe('composed calls after native consent', () => {
  it.each([
    ['check-in', 'allow'],
    ['middleware', 'allow'],
    ['credential', 'allow'],
    ['check-in', 'halt'],
    ['middleware', 'halt'],
    ['credential', 'halt'],
  ] as const)(
    'honors %s resume and a %s from the inner permission check',
    async (door, decision) => {
      const sample = target('sample');
      const compose = composing(async (call) => call('sample', { account: 'fixture' }));
      const outer = {
        ...compose.tool,
        ...(door === 'check-in' && { checkIn: 'always' as const }),
        ...(door === 'credential' && { needs: { credential: 'sample' } }),
      };
      const checker = checkerOf((request) =>
        request.target === 'sample' && decision === 'halt'
          ? { result: 'halt', reason: 'fixture-stop' }
          : { result: 'allow' },
      );
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

      const resumed = agent.resume(paused.checkpoint, answer);
      if (decision === 'halt') {
        await expect(resumed).rejects.toBeInstanceOf(PolicyHaltError);
        expect(sample.entered).toEqual([]);
        expect(seen.of('permission.halt').map((event) => event.payload.toolCallId)).toEqual([
          'c1#inner-1',
        ]);
      } else {
        await expect(resumed).resolves.toBe('done');
        expect(sample.entered).toEqual([{ account: 'fixture' }]);
      }
      expect(checker.requests.find((request) => request.target === 'sample')?.context).toEqual({
        account: 'fixture',
      });
      expect(seen.of('permission.check').map((event) => event.payload.toolCallId)).toContain(
        'c1#inner-1',
      );
      expect(rows(agent)).toMatchObject([
        {
          toolCallId: 'c1#inner-1',
          toolName: 'sample',
          entered: decision === 'allow',
          ended: decision === 'allow' ? 'returned' : 'refused',
        },
      ]);
    },
  );
});
