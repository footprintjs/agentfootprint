/**
 * `absent({ what, checked: 'declared' })` — an absence whose coverage the
 * tool's `search` declares, so the author writes the search once.
 *
 * The literal satisfies the mint rule (a non-empty `checked`) by saying the
 * tool declared it. The mint cannot see the tool, so the envelope carries the
 * literal; the dispatch funnel composes the coverage from the declaration and
 * the arguments the call ran with. Until then every reader that predates it
 * sees DATA, never a half-read absence: `readAbsence` stays strict.
 *
 * Sections: Unit · Contract · Edge · Regression.
 */

import { describe, expect, it } from 'vitest';

import { ABSENCE_NOTE, absent, readAbsence } from '../../../../src/semantics/coverage/absent.js';
import { readDeclaredAbsence } from '../../../../src/semantics/coverage/recognize.js';

describe("absent({ checked: 'declared' }) — unit", () => {
  it('mints the literal and the static note', () => {
    expect(absent({ what: 'open incidents on payments', checked: 'declared' })).toEqual({
      af_absent: true,
      outcome: 'nothing_found',
      looked_for: 'open incidents on payments',
      checked: 'declared',
      retry_returns_the_same: true,
      note: ABSENCE_NOTE,
    });
  });

  it('carries resolved and paging as declared', () => {
    const minted = absent({
      what: 'open incidents on payments',
      checked: 'declared',
      resolved: [{ argument: 'service', id: 'payments', aliases: ['pay-svc'] }],
      paging: { next: null },
    });
    expect(minted.resolved).toEqual([
      { argument: 'service', id: 'payments', aliases: ['pay-svc'] },
    ]);
    expect(minted.paging).toEqual({ next: null });
  });

  it('keeps hand-written notChecked beside it — a prose gap', () => {
    const minted = absent({
      what: 'x',
      checked: 'declared',
      notChecked: [{ what: 'the archive', why: 'older than the window' }],
    });
    expect(minted.not_checked).toEqual([{ what: 'the archive', why: 'older than the window' }]);
  });
});

describe("absent({ checked: 'declared' }) — contract: one recognizer for the new shape", () => {
  it('readAbsence stays strict: the literal is not an absence until composed', () => {
    expect(readAbsence(absent({ what: 'x', checked: 'declared' }))).toBeUndefined();
  });

  it('readDeclaredAbsence recognizes it, and nothing else', () => {
    const declared = absent({ what: 'x', checked: 'declared' });
    expect(readDeclaredAbsence(declared)).toBe(declared);
    expect(readDeclaredAbsence(absent({ what: 'x', checked: ['the store'] }))).toBeUndefined();
    expect(readDeclaredAbsence({ af_absent: true, checked: 'all' })).toBeUndefined();
    expect(readDeclaredAbsence([])).toBeUndefined();
    expect(readDeclaredAbsence(null)).toBeUndefined();
  });

  it('refuses a malformed resolved or paging at the mint', () => {
    expect(() => absent({ what: 'x', checked: 'declared', resolved: [] as never })).toThrow(
      /^refused: .*resolved/,
    );
    expect(() => absent({ what: 'x', checked: 'declared', paging: {} as never })).toThrow(
      /^refused: .*paging/,
    );
  });
});

describe("absent({ checked: 'declared' }) — edge and regression", () => {
  it('any other string is refused, as before', () => {
    expect(() => absent({ what: 'x', checked: 'all' as never })).toThrow(/^refused: /);
  });

  it('a hand-written list mints byte for byte as before', () => {
    expect(absent({ what: 'x', checked: ['the store'] })).toEqual({
      af_absent: true,
      outcome: 'nothing_found',
      looked_for: 'x',
      checked: [{ what: 'the store' }],
      retry_returns_the_same: true,
      note: ABSENCE_NOTE,
    });
  });
});
