/**
 * The answer account on the REAL recording (fixture A: `recording-turn2.json`,
 * reduced) — the design's §7.3 table, line by line, and the byte-stable golden
 * of the whole account.
 *
 * Test types (Convention 3):
 *   - FUNCTIONAL — A (with neo's declarations), A0 (the record alone) and B
 *                  (SYNTHETIC: every af-1 field declared) print exactly the
 *                  sentences, vouchers and one-liners the design fixes;
 *   - REGRESSION — the whole account (and its "show me" map) is pinned byte
 *                  for byte, so a word or a pointer cannot drift unnoticed.
 */

import { describe, expect, it } from 'vitest';

import { accountForAnswer } from '../../../src/lib/answer-account/account.js';
import { showLeaves } from '../../../src/lib/answer-account/shown.js';
import type { AnswerAccount, RowId } from '../../../src/lib/answer-account/types.js';
import { dump, fixtureA, fixtureB, FLAGSHIP_RUN_ID, golden, NEO_DECLARATIONS } from './helpers.js';

const rowOf = (account: AnswerAccount, id: RowId) => account.rows.find((r) => r.id === id)!;
const said = (account: AnswerAccount, id: RowId) =>
  rowOf(account, id).lines.map((l) => [l.text, l.source] as const);

describe('fixture A — the real run, with neo’s declarations', () => {
  const rec = fixtureA();
  const account = accountForAnswer(rec, NEO_DECLARATIONS, { runId: rec.meta.origin.runId });

  it('reads its own run only, and says which', () => {
    expect(account.scope).toBe('own-run');
    expect(account.run.value).toMatchObject({
      runId: FLAGSHIP_RUN_ID,
      turnNumber: 2,
      resumedLeg: false,
    });
    expect(account.foreign).toBe(0);
    expect(account.unread).toBe(0);
  });

  it('You asked — the person’s words, vouched by the person', () => {
    expect(said(account, 'asked')).toEqual([
      ['“what applications are running on powerstore SHPSTRPLPCL003”', 'person'],
    ]);
  });

  it('It understood — the library’s verdict, the app’s scores, delivery, and what is not recorded', () => {
    expect(said(account, 'understood')).toEqual([
      ["The library's routing picked the array estate report skill (array-inventory).", 'library'],
      ["The app's scoring put it first: 1 against 0 for every other skill.", 'app'],
      ['The skill was given to the model before it answered.', 'library'],
      ['How sure the routing was is not recorded.', 'library'],
      ['Whether the app itself decided a skill for this question is not recorded.', 'app'],
    ]);
    const pick = rowOf(account, 'understood').lines[0]!;
    // The label is presentation with its OWN voucher; the claim stays the library's.
    expect(pick.parts).toContainEqual({ label: 'array estate report', source: 'app' });
    expect(pick.parts).toContainEqual({ code: 'array-inventory' });
    expect(rowOf(account, 'understood').lines[2]!.chips?.map((c) => c.text)).toEqual([
      'decided = delivered',
    ]);
  });

  it('It checked / It did not check — the tool’s declaration, verbatim, vouched by the tool', () => {
    const checked = rowOf(account, 'checked').lines;
    expect(checked[0]!.text).toBe('get_array_inventory says it checked:');
    expect(
      checked.slice(1).every((l) => l.item === true && l.source === 'tool:get_array_inventory'),
    ).toBe(true);
    expect(
      checked[2]!.text.startsWith(
        'vDisk and vm_rdm_map: every VM disk in the RVTools export dated 2026-09-19',
      ),
    ).toBe(true);
    expect(rowOf(account, 'not-checked').lines.map((l) => l.text)).toEqual([
      'get_array_inventory says it did not check:',
      'whether that name is a storage array, and which VM disks are on it',
      'hosts that are not VMware — AIX LPARs and physical servers',
      'PowerMax array performance',
      'VM disks this tool attributes to no array: 4 in this export',
    ]);
  });

  it('It found — the declared absence (tool), and the earlier empty result in view (app)', () => {
    expect(said(account, 'found')).toEqual([
      [
        'get_array_inventory looked for a VM disk in the RVTools export attributed to the array asked and found none.',
        'tool:get_array_inventory',
      ],
      [
        'The model could also see the result of powerstore_get_volumes from an earlier answer (at least 1 answer back): an empty result that did not declare what it searched.',
        'app',
      ],
    ]);
  });

  it('How sure — standing not recorded; the expectation and the outcome side by side, no "instead"', () => {
    expect(said(account, 'how-sure')).toEqual([
      ['The record does not rate how sure this answer is.', 'library'],
      [
        'Before calling get_array_inventory, the model said it expected this call to answer the question directly, and rated how useful it expected the result to be: high.',
        'model',
      ],
      ['The call found nothing.', 'tool:get_array_inventory'],
      [
        "The library checked the answer's names and numbers: none was missing from what the tools returned, your message, the conversation or the app's own instructions (recalled memory included).",
        'library',
      ],
    ]);
  });

  it('Anything wrong — one signal, no errors, one check that could not run', () => {
    expect(said(account, 'anything-wrong')).toEqual([
      [
        'An empty result that did not declare what it searched, from powerstore_get_volumes in an earlier answer (at least 1 answer back), was in front of the model when it answered.',
        'app',
      ],
      ['No tool call failed or was refused.', 'library'],
      ['1 of the 3 checks could not be run on this record.', 'library'],
      [
        'It cannot be told whether get_array_inventory checked that the thing asked about exists: its not-checked items do not say what kind they are.',
        'library',
      ],
    ]);
    expect(account.signals.map((s) => s.id)).toEqual(['undeclared-empty-in-view']);
  });

  it('In one line — warn, vouched by the app', () => {
    expect(account.summary.tone).toBe('warn');
    expect(account.summary.sentence.source).toBe('app');
    expect(account.summary.sentence.text).toBe(
      'An empty result that did not declare what it searched, from powerstore_get_volumes in an earlier answer (at least 1 answer back), was in front of the model when it answered.',
    );
  });

  it('REGRESSION — the account, its text and its show-me map are byte-stable', () => {
    golden('turn2.A.txt', dump(account));
    golden('turn2.A.account.json', account);
    golden('turn2.A.shown.json', showLeaves(account, rec, NEO_DECLARATIONS));
  });
});

describe('fixture A0 — the same run, the record alone', () => {
  const rec = fixtureA();
  const account = accountForAnswer(rec, undefined, { runId: rec.meta.origin.runId });

  it('the skill is its id; no app line; the in-view line makes no emptiness claim', () => {
    expect(rowOf(account, 'understood').lines[0]!.text).toBe(
      "The library's routing picked the array-inventory skill.",
    );
    expect(rowOf(account, 'understood').lines.map((l) => l.template.id)).not.toContain(
      'understood.app.notRecorded',
    );
    expect(said(account, 'found')[1]).toEqual([
      'The model could also see the result of powerstore_get_volumes from an earlier answer (at least 1 answer back).',
      'library',
    ]);
  });

  it('two checks cannot run; the one-liner says so, tone unknown', () => {
    const wrong = rowOf(account, 'anything-wrong').lines.map((l) => l.text);
    expect(wrong).toContain('2 of the 3 checks could not be run on this record.');
    expect(wrong).toContain(
      'It cannot be told whether the result of powerstore_get_volumes was empty: its shape is not declared.',
    );
    expect(account.signals).toEqual([]);
    expect(account.summary.tone).toBe('unknown');
    expect(account.summary.sentence.text).toBe(
      'Nothing this report looks for turned up, but 2 of the 3 checks could not be run on this record.',
    );
  });

  it('REGRESSION — byte-stable', () => {
    golden('turn2.A0.txt', dump(account));
  });
});

describe('fixture B — SYNTHETIC: every af-1 field declared', () => {
  const account = accountForAnswer(fixtureB(), NEO_DECLARATIONS, { runId: FLAGSHIP_RUN_ID });

  it('the label is the recorded title (library); items print their short forms with kind chips', () => {
    const pick = rowOf(account, 'understood').lines[0]!;
    expect(pick.parts).toContainEqual({ label: 'array estate report', source: 'library' });
    const items = rowOf(account, 'not-checked').lines.filter((l) => l.item);
    expect(items.map((l) => [l.text, l.chips?.[0]?.text])).toEqual([
      ['whether that name is a storage array', 'whether it exists'],
      ['hosts that are not VMware', 'outside what it covers'],
      ['PowerMax array performance', 'outside what it covers'],
      ['VM disks this tool attributes to no array', 'outside what it covers'],
    ]);
  });

  it('the evidence line counts what was looked up', () => {
    expect(rowOf(account, 'how-sure').lines.map((l) => l.text)).toContain(
      'The library looked up 1 value from the answer in what the tools returned and found it.',
    );
  });

  it('two signals, no unreachable line, and the one-liner quotes both (warn, voucher app — the weaker)', () => {
    expect(account.signals.map((s) => s.id)).toEqual([
      'existence-not-checked',
      'undeclared-empty-in-view',
    ]);
    expect(account.unreachable).toEqual([]);
    expect(account.summary.tone).toBe('warn');
    expect(account.summary.sentence.source).toBe('app');
    expect(account.summary.sentence.text).toBe(
      'get_array_inventory says it did not check whether that name is a storage array. An empty result that did not declare what it searched, from powerstore_get_volumes in an earlier answer (at least 1 answer back), was in front of the model when it answered.',
    );
  });

  it('REGRESSION — byte-stable', () => {
    golden('turn2.B.txt', dump(account));
  });
});
