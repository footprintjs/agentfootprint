/**
 * `hiddenArgNames` — the one answer to "which arguments does this tool's view
 * hide in this call". Read from the view, never from the shown text.
 */
import { describe, expect, it } from 'vitest';

import {
  argsRedactedBy,
  hiddenArgNames,
  SHOWN_ARGS,
  shownFieldsOf,
  type ShownArgs,
} from './toolShownArgs.js';

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

  it('a view whose choice for one argument depends on another is read one key at a time (review G)', () => {
    // Hides `to` only for a wire; the real `to` already equals the placeholder.
    const tool = withView((a) => (a.memo === 'wire' ? { ...a, to: 'REDACTED' } : a));
    expect(hiddenArgNames(tool, { to: 'REDACTED', memo: 'wire' })).toEqual(['to']);
    expect(hiddenArgNames(tool, { to: 'REDACTED', memo: 'rent' })).toEqual([]);
  });

  it('a view that checks a number is not misread as hiding it (review F)', () => {
    const tool = withView((a) => ({
      ...a,
      to: 'REDACTED',
      amount: Number.isFinite(a.amount) ? a.amount : 'REDACTED',
    }));
    expect(hiddenArgNames(tool, { to: 'acct-9', amount: 5000, memo: 'rent' })).toEqual(['to']);
  });

  it('a view that throws on another type than the real one lists only what it hides (review B3)', () => {
    const tool = withView((a) => {
      if (typeof a.amount !== 'number') throw new Error('amount must be a number');
      return { ...a, to: 'REDACTED' };
    });
    expect(hiddenArgNames(tool, { to: 'acct-9', amount: 5000, memo: 'rent' })).toEqual(['to']);
  });

  it('a probe the view throws on cannot decide, so the name is listed', () => {
    const tool = withView((a) => {
      if (a.memo !== 'rent') throw new Error('unknown memo');
      return a;
    });
    expect(hiddenArgNames(tool, { memo: 'rent', amount: 5 })).toEqual(['memo']);
  });

  it('reads the output the caller already has instead of running the view again for it', () => {
    let calls = 0;
    const view = argsRedactedBy({ keys: ['to'] });
    const tool = withView((a) => {
      calls += 1;
      return view(a);
    });
    const args = { to: 'acct-9', amount: 5 };
    const shown = tool[SHOWN_ARGS](args);
    calls = 0;
    expect(hiddenArgNames(tool, args, shown)).toEqual(['to']);
    expect(calls).toBe(0); // only strings that came back unchanged are probed; there are none
  });

  it('the answer holds names only', () => {
    const tool = withView(argsRedactedBy({ keys: ['to'] }));
    expect(JSON.stringify(hiddenArgNames(tool, { to: 'acct-SECRET' }))).not.toContain('SECRET');
  });
});

describe('shownFieldsOf — what stream.tool_start adds for a tool whose view hides something', () => {
  it('the view output and the names, frozen; nothing at all otherwise', () => {
    const tool = withView(argsRedactedBy({ keys: ['to'] }));
    const fields = shownFieldsOf(tool, { to: 'acct-SECRET', amount: 5 });
    expect(fields).toEqual({ shownArgs: { to: 'REDACTED', amount: 5 }, hiddenArgs: ['to'] });
    expect(Object.isFrozen(fields.shownArgs)).toBe(true);
    expect(Object.isFrozen(fields.hiddenArgs)).toBe(true);
    expect(JSON.stringify(fields)).not.toContain('SECRET');
    expect(shownFieldsOf(tool, { amount: 5 })).toEqual({});
    expect(shownFieldsOf({}, { to: 'acct-9' })).toEqual({});
  });
});
