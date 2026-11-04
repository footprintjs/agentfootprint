import { describe, expect, it } from 'vitest';
import { defineTool } from '../../../index.js';
import { SHOWN_ARGS } from '../../toolShownArgs.js';
import { timeWindowsLine, withArgumentRules, type ServedWindows } from './serve.js';

const privateDefault = 'private-schema-default-fixture';
const defaults = defineTool({
  name: 'lookup',
  description: 'Look up an account',
  inputSchema: {
    type: 'object',
    required: ['account', 'region'],
    properties: {
      account: { type: 'string' },
      region: { type: 'string' },
    },
  },
  askOrAssume: { account: { assume: privateDefault }, region: { assume: 'eu' } },
  execute: () => 'found',
});
const conditional = {
  ...defaults,
  [SHOWN_ARGS]: (args: Readonly<Record<string, unknown>>) =>
    args.region === 'eu' ? { ...args, account: 'REDACTED' } : args,
};

describe('hypothetical schema values have no full call context', () => {
  it('does not reveal a default whose mapper requires a sibling context', () => {
    const served = withArgumentRules(conditional.schema, conditional);
    expect(JSON.stringify(served).includes(privateDefault)).toBe(false);
    expect(JSON.stringify(served)).toContain("hidden by the tool's view");
    expect(served.inputSchema).not.toHaveProperty('required');
    expect(defaults.schema.inputSchema.required).toEqual(['account', 'region']);
  });

  it('treats a mapper returning a one-key probe unchanged as insufficient public proof', () => {
    const unmapped = {
      ...defaults,
      [SHOWN_ARGS]: (args: Readonly<Record<string, unknown>>) => args,
    };
    expect(
      JSON.stringify(withArgumentRules(unmapped.schema, unmapped)).includes(privateDefault),
    ).toBe(false);
  });

  it('keeps the established default sentence byte for byte when no mapper exists', () => {
    const served = withArgumentRules(defaults.schema, defaults);
    const properties = served.inputSchema.properties as Record<string, { description: string }>;
    expect(properties.account.description).toBe(
      `If left out, the tool's rule fills "${privateDefault}", recorded as assumed.`,
    );
    expect(properties.region.description).toBe(
      'If left out, the tool\'s rule fills "eu", recorded as assumed.',
    );
  });
});

it('a hypothetical converted window cannot establish publicness from a one-key probe', () => {
  const period = defineTool({
    name: 'lookup_window',
    description: 'Look up a window',
    inputSchema: {
      type: 'object',
      properties: {
        window: { type: 'string' },
        region: { type: 'string' },
      },
    },
    askOrAssume: { window: { assume: '1h' }, region: { assume: 'eu' } },
    period: { argument: 'window', spelling: 'lookback' },
    execute: () => 'found',
  });
  const privatePeriod = {
    ...period,
    [SHOWN_ARGS]: (args: Readonly<Record<string, unknown>>) =>
      args.region === 'eu' ? { ...args, window: 'REDACTED' } : args,
  };
  const windows: ServedWindows = {
    now: '2026-11-04T12:00:00Z',
    windows: [
      {
        source: 'answered',
        answer: 'confirmed',
        mention: 0,
        quote: 'chosen range',
        range: { from: '2026-11-04T10:00:00Z', to: '2026-11-04T12:00:00Z' },
        zone: 'UTC',
      },
    ],
  };
  const hidden = timeWindowsLine(
    [privatePeriod.schema],
    new Map([['lookup_window', privatePeriod]]),
    windows,
  );
  expect(hidden?.includes('"2h"')).toBe(false);
  expect(hidden).toContain("lookup_window window (hidden by the tool's view)");
  const publicLine = timeWindowsLine(
    [period.schema],
    new Map([['lookup_window', period]]),
    windows,
  );
  expect(publicLine).toContain('lookup_window window "2h"');
  expect(hidden).toContain('chosen range');
});
