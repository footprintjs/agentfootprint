/**
 * README law 8 in its own unit: the account is at most 128 KiB, and the op's
 * body (`{ account, shown }`, `hosting/artifactWire.ts` ·
 * `AnswerAccountWireBody`) at most 192 KiB, SERIALIZED — the UTF-8 bytes of
 * the JSON, escaping included — on any record.
 *
 * A character is not a byte. JSON writes a control character or a lone
 * surrogate as six bytes, and UTF-8 a BMP character as up to three; a pointer
 * repeats its identity on every line that names its event. So no cut in
 * characters, per field, adds up to a byte bound. Two saved-record regressions start from a record at the writer's own caps and change only
 * identities: one event's `runtimeStageId` of 200 U+0001 characters, and every
 * id and name 200 U+FFFF characters (210,331 bytes in the account and 227,714
 * in the body, by the length 99,489 "characters" every earlier test measured).
 *
 * The account answers within the bound, and says what it did not list: every
 * line of the record's account is either in it or counted by a size fold, and
 * every judgement — the counts, the checks, a row's status — still covers
 * everything, as on the unedited record.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { accountForAnswer } from '../../src/observe.js';
import { showLeaves } from '../../src/answer-account/shown.js';
import { MAX_CODE_REGIONS } from '../../src/core/agent/evidence/codeRegions.js';
import { MAX_ATTACHED_SCRIPTS } from '../../src/core/agent/scripts/attachment.js';
import type { AnswerAccount } from '../../src/answer-account/types.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import { assertP1 } from './helpers.js';
import {
  filled,
  lastOf,
  matchedRecording,
  withIdentities,
  type Doc,
} from './fixtures/writerCaps.js';

/** The contract's own measure: UTF-8 bytes of the JSON. */
const utf8Bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
const ACCOUNT_LIMIT = 128 * 1024;
const BODY_LIMIT = 192 * 1024;

/** Per row: the lines listed, plus the lines a size fold says it did not list. */
function linesSaidOrCounted(account: AnswerAccount): number[] {
  return account.rows.map((row) =>
    row.lines.reduce((sum, line) => {
      if (line.template.id !== 'row.sizeBound') return sum + 1;
      const n = line.vars.n?.value;
      return sum + (typeof n === 'number' ? n : Number.NaN);
    }, 0),
  );
}

/** What the account judged — never changed by what fits. */
const judged = (account: AnswerAccount) => ({
  errors: account.facts.errors,
  checks: account.facts.checks,
  tone: account.summary.tone,
  standing: account.facts.standing.value,
  status: account.rows.map((row) => row.status),
  chips: account.rows.map((row) => row.chips.map((chip) => chip.mark)),
});

describe('the size contract, in serialized UTF-8 bytes', () => {
  let caps: Recording;
  let control: AnswerAccount;
  beforeAll(async () => {
    caps = filled(await matchedRecording(), MAX_CODE_REGIONS, MAX_ATTACHED_SCRIPTS);
    control = accountForAnswer(caps);
  });

  it('control: the record at the writer caps, ASCII, is within the bound and folds nothing', () => {
    expect(utf8Bytes(control)).toBeLessThanOrEqual(ACCOUNT_LIMIT);
    expect(control.rows.flatMap((r) => r.lines).map((l) => l.template.id)).not.toContain(
      'row.sizeBound',
    );
  });

  it.each([
    [
      "one event's runtimeStageId of 200 U+0001 characters (saved-record regression)",
      (r: Recording) => {
        const doc = JSON.parse(JSON.stringify(r)) as Doc;
        const event = lastOf(doc, 'agent.evidence_checked') as unknown as {
          meta: Record<string, unknown>;
        };
        event.meta.runtimeStageId = '\u0001'.repeat(200);
        return doc as unknown as Recording;
      },
    ],
    [
      'every id and name 200 U+FFFF characters (saved-record regression)',
      (r: Recording) => withIdentities(r, '￿'.repeat(200)),
    ],
    [
      'every id and name 200 control characters',
      (r: Recording) => withIdentities(r, '\u0001'.repeat(200)),
    ],
    [
      'every id and name 200 lone surrogates',
      (r: Recording) => withIdentities(r, '\ud800'.repeat(200)),
    ],
    [
      'every id and name 100 astral characters',
      (r: Recording) => withIdentities(r, '\u{10FFFF}'.repeat(100)),
    ],
    [
      'every id and name 2,048 U+FFFF characters (the show-me map at its leaf cut)',
      (r: Recording) => withIdentities(r, '￿'.repeat(2048)),
    ],
  ])(
    '%s: account ≤ 128 KiB, body ≤ 192 KiB; every line said or counted; judged as before',
    (_name, edit) => {
      const recording = edit(caps);
      const account = accountForAnswer(recording);
      const shown = showLeaves(account, recording);
      expect(utf8Bytes(account)).toBeLessThanOrEqual(ACCOUNT_LIMIT);
      expect(utf8Bytes({ account, shown })).toBeLessThanOrEqual(BODY_LIMIT);
      expect(linesSaidOrCounted(account)).toEqual(linesSaidOrCounted(control));
      expect(judged(account)).toEqual(judged(control));
      expect(account.unread).toBe(control.unread);
      // Every pointer the account keeps still lands in the record (P1).
      assertP1(account, recording);
    },
  );
});
