/**
 * `hiddenArgNames` — the one answer to "which arguments does this tool's view
 * hide in this call". Read from the view, never from the shown text.
 */
import { describe, expect, it } from 'vitest';

import { argsRedactedBy, hiddenArgNames, SHOWN_ARGS, type ShownArgs } from './toolShownArgs.js';

const withView = (view: ShownArgs) => ({ [SHOWN_ARGS]: view });

describe('hiddenArgNames', () => {
  it('a tool without a view hides nothing', () => {
    expect(hiddenArgNames({}, { to: 'acct-9' })).toEqual([]);
    expect(hiddenArgNames(undefined, { to: 'acct-9' })).toEqual([]);
  });

  it('names a replaced value, in argument order', () => {
    const tool = withView(argsRedactedBy({ keys: ['to', 'pin'] }));
    expect(hiddenArgNames(tool, { pin: 1234, amount: 5, to: 'acct-9' })).toEqual(['pin', 'to']);
  });

  it('a real value that is the string "REDACTED" is not hidden; a hidden one that is, is', () => {
    const tool = withView(argsRedactedBy({ keys: ['to'] }));
    expect(hiddenArgNames(tool, { to: 'acct-9', memo: 'REDACTED' })).toEqual(['to']);
    expect(hiddenArgNames(tool, { to: 'REDACTED', memo: 'rent' })).toEqual(['to']);
  });

  it('a nested field hidden inside an argument names the argument', () => {
    const tool = withView(argsRedactedBy({ fields: { payee: ['iban'] } }));
    expect(hiddenArgNames(tool, { payee: { name: 'n', iban: 'x' }, amount: 5 })).toEqual(['payee']);
  });

  it('an untouched object argument is not hidden (the view keeps its reference)', () => {
    const tool = withView(argsRedactedBy({ keys: ['to'] }));
    expect(hiddenArgNames(tool, { to: 'a', meta: { k: 1 }, list: [1, 2] })).toEqual(['to']);
  });

  it('a key the view removes is hidden; a key it adds is not an argument', () => {
    const tool = withView(({ to: _to, ...rest }) => ({ ...rest, added: 1 }));
    expect(hiddenArgNames(tool, { to: 'a', amount: 5 })).toEqual(['to']);
  });

  it('a view that throws hides every argument', () => {
    const tool = withView(() => {
      throw new Error('no');
    });
    expect(hiddenArgNames(tool, { to: 'a', amount: 5 })).toEqual(['to', 'amount']);
  });

  it('the answer holds names only', () => {
    const tool = withView(argsRedactedBy({ keys: ['to'] }));
    expect(JSON.stringify(hiddenArgNames(tool, { to: 'acct-SECRET' }))).not.toContain('SECRET');
  });
});
