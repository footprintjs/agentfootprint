import { describe, expect, it } from 'vitest';
import { SHOWN_ARGS } from '../../../src/core/toolShownArgs.js';
import { Agent, allow, isPaused, pauseHere } from '../../../src/index.js';
import { mock } from '../../../src/providers.js';
import { checkerOf, composing, events, rows, target } from './fixtures/innerCalls.js';

describe('the policy input of a prior composed call', () => {
  it.each([false, true])(
    'keeps actual input private while a later call is checked (paused=%s)',
    async (paused) => {
      const swatch = target('swatch');
      const protectedSwatch = {
        ...swatch.tool,
        [SHOWN_ARGS]: (args: Record<string, unknown>) => ({ ...args, account: 'REDACTED' }),
      };
      const compose = composing(async (call) => {
        await call('swatch', { account: 'fixture-mauve' });
        if (paused) pauseHere({ question: 'Continue?' });
      });
      const marker = target('marker');
      const checker = checkerOf(() => ({ result: 'allow' }));
      const provider = mock({
        replies: [
          { toolCalls: [{ id: 'compose-1', name: 'compose', args: {} }] },
          { toolCalls: [{ id: 'marker-1', name: 'marker', args: {} }] },
          { content: 'done' },
        ],
      });
      const agent = Agent.create({ provider, model: 'fixture', permissionChecker: checker })
        .tools([protectedSwatch, compose.tool, marker.tool])
        .toolMiddleware({
          name: 'fixture-color',
          onToolCall: (call) =>
            call.toolName === 'swatch'
              ? allow({ account: 'fixture-ochre' }, 'Use the fixture palette.')
              : allow(),
        })
        .build();
      const seen = events(agent);
      const first = await agent.run({ message: 'Classify an example swatch.' });
      if (paused) {
        if (!isPaused(first)) throw new Error('expected a paused fixture');
        const checkpoint = JSON.parse(JSON.stringify(first.checkpoint)) as typeof first.checkpoint;
        await agent.resume(checkpoint, 'Continue.');
      }
      const request = checker.requests.find((value) => value.target === 'marker');
      expect(compose.told).toEqual(['ran: swatch-done']);
      expect(swatch.entered).toEqual([{ account: 'fixture-ochre' }]);
      expect(marker.entered).toEqual([{}]);
      expect(request?.sequence?.find((value) => value.inner)).toMatchObject({
        args: { account: 'fixture-ochre' },
      });
      expect(request?.history?.find((value) => value.calls !== undefined)?.calls).toMatchObject([
        { args: { account: 'REDACTED' } },
      ]);
      expect(rows(agent)).toMatchObject([
        { toolName: 'swatch', args: { account: 'REDACTED' }, entered: true },
      ]);
      expect(JSON.stringify(agent.getLastSnapshot())).not.toMatch(/fixture-(mauve|ochre)/);
      expect(JSON.stringify(seen.of('agent.iteration_end'))).not.toMatch(/fixture-(mauve|ochre)/);
    },
  );
});
