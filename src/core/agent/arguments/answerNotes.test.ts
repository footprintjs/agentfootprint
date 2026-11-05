import { describe, expect, it } from 'vitest';
import { defineTool } from '../../../index.js';
import { SHOWN_ARGS } from '../../toolShownArgs.js';
import { addPrivateRecordFields } from '../../../redaction/privateFields.js';
import { noteFor } from './dispatch.js';
import {
  privateFilledArguments,
  privateKeptSelections,
  privateResolutionArguments,
} from './privateAnswers.js';
import type { ArgumentFill, ArgumentResolution } from './resolve.js';

const privateValue = 'private-note-fixture';
const tool = {
  ...defineTool({ name: 'lookup', description: 'Look up', execute: () => 'found' }),
  [SHOWN_ARGS]: (args: Readonly<Record<string, unknown>>) =>
    args.region === 'eu' ? { ...args, account: 'REDACTED' } : args,
};
const resolution = (fill: ArgumentFill): ArgumentResolution => ({
  toolCallId: 'one',
  iteration: 1,
  fills: [fill],
});

describe('filled result notes use the actual complete call view', () => {
  it.each([
    { source: 'answered' as const },
    { source: 'answered' as const, window: true as const },
    { source: 'window' as const, from: 'said' as const },
    { source: 'default' as const },
  ])('hides a conditional $source fill while preserving the public sibling', (origin) => {
    const row = resolution({ argument: 'account', value: privateValue, ...origin });
    const hidden = noteFor('lookup', tool, row, { region: 'eu', account: privateValue });
    expect(hidden.includes(privateValue)).toBe(false);
    expect(hidden).toContain('hidden by the tool');
    const publicNote = noteFor('lookup', tool, row, { region: 'public', account: privateValue });
    expect(publicNote).toContain(privateValue);
  });

  it('does not expose a carried private value when the final call has public context', () => {
    const row = resolution({ argument: 'account', source: 'answered', value: 'public-final' });
    const note = noteFor(
      'lookup',
      tool,
      row,
      { region: 'public', account: 'public-final' },
      { region: 'eu', account: privateValue },
    );
    expect(note.includes(privateValue)).toBe(false);
    expect(note).toContain('the call had carried a value of its own');
  });

  it('retains the established public note byte for byte without an argument view', () => {
    const row = resolution({ argument: 'limit', source: 'answered', value: 42 });
    expect(noteFor('lookup', undefined, row, { limit: 42 })).toBe(
      '\n\n[limit = 42 in the lookup call this result answers was chosen by the person when asked (the call had left it out).]',
    );
  });
});

it('admitted resolved privacy follows call/iteration and fill name into a kept list without a tool', () => {
  const row = resolution({ argument: 'account', source: 'answered', value: privateValue });
  const prior = addPrivateRecordFields(undefined, [
    { root: 'argumentResolutions', path: '1.fills.0.value' },
  ]);
  const other = { ...row, toolCallId: 'other' };
  const privateArguments = privateResolutionArguments(prior, [other, row], row);
  expect([...privateArguments]).toEqual(['account']);
  expect([...privateResolutionArguments(prior, [other, { ...row, iteration: 2 }], row)]).toEqual(
    [],
  );
  expect(
    privateKeptSelections(
      prior,
      [],
      [
        { turn: 3, toolName: 'lookup', argument: 'account', value: privateValue },
        { turn: 3, toolName: 'lookup', argument: 'region', value: privateValue },
      ],
      3,
      { toolName: 'lookup', tool: undefined, args: {}, privateArguments },
    ),
  ).toEqual([{ root: 'argumentAnswersKept', path: '0.value' }]);
});

it('unreadable admitted resolution indices hide fills while plain notes read no scope fields', () => {
  const row = resolution({ argument: 'account', source: 'answered', value: privateValue });
  const prior = addPrivateRecordFields(undefined, [
    { root: 'argumentResolutions', path: '8.fills.0.value' },
  ]);
  expect([...privateResolutionArguments(prior, [], row)]).toEqual(['account']);
  const untouched = new Proxy(
    {},
    {
      get() {
        throw Error('Unexpected plain-run scope read');
      },
    },
  );
  expect([...privateFilledArguments(untouched, undefined, { account: privateValue }, row)]).toEqual(
    [],
  );
});
