import { describe, expect, it } from 'vitest';
import { defineTool } from '../../../index.js';
import { SHOWN_ARGS } from '../../toolShownArgs.js';
import { rowsOf, type CheckedArgument } from './resolve.js';

const privateValue = 'private-resolved-sibling-fixture';
function tool(source: 'default' | 'answered', region: string) {
  const base = defineTool({
    name: 'lookup',
    description: 'Lookup',
    inputSchema: {
      type: 'object',
      properties: { account: { type: 'string' }, region: { type: 'string' } },
    },
    askOrAssume:
      source === 'default'
        ? { account: { assume: privateValue }, region: { assume: region } }
        : { account: { ask: 'Account?' }, region: { ask: 'Region?' } },
    execute: () => 'found',
  });
  return {
    ...base,
    [SHOWN_ARGS]: (args: Record<string, unknown>) =>
      args.region === 'eu' ? { ...args, account: 'REDACTED' } : args,
  };
}
for (const source of ['default', 'answered'] as const)
  describe(`resolved ${source} sibling context`, () => {
    for (const order of [
      ['account', 'region'],
      ['region', 'account'],
    ]) {
      const rows = (region: string) => {
        const checked = order.map(
          (argument): CheckedArgument => ({
            toolCallId: 'one',
            toolName: 'lookup',
            argument,
            rule: source === 'default' ? 'assume' : 'ask',
            source,
            filled: true,
          }),
        );
        const kept =
          source === 'answered'
            ? [
                { turn: 1, toolName: 'lookup', argument: 'account', value: privateValue },
                { turn: 1, toolName: 'lookup', argument: 'region', value: region },
              ]
            : undefined;
        return rowsOf(
          checked,
          [{ id: 'one', name: 'lookup', args: {} }],
          () => tool(source, region),
          { turn: 1, iteration: 1 },
          kept,
        );
      };
      it(`${order.join('/')} masks with the full actual filled call`, () => {
        const result = rows('eu');
        expect(result.map((row) => ('argument' in row ? row.argument : undefined))).toEqual(order);
        expect(JSON.stringify(result).includes(privateValue)).toBe(false);
        expect(result).toContainEqual(expect.objectContaining({ argument: 'region', value: 'eu' }));
      });
      it(`${order.join('/')} preserves a genuinely public value`, () => {
        expect(rows('public')).toContainEqual(
          expect.objectContaining({ argument: 'account', value: privateValue }),
        );
      });
    }
  });
