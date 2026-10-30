/**
 * The account's script lines within the account's bound (README law 8: the
 * account stays ≤ 128 KB and the op's response ≤ 192 KB, by construction).
 *
 * A record the writer itself could file holds up to `MAX_CODE_REGIONS` (32)
 * shown-block verdicts and `MAX_ATTACHED_SCRIPTS` (8) attached scripts, each
 * with its extra lines (a withheld result, a before-tool rewrite, a cut).
 * Saying all of them would cross the bound, so the script lines are listed the
 * way every per-call listing of the account is (law 7, "judge everything; cap
 * only what is listed"): the first `MAX_LISTED_CALLS` of each kind, then one
 * "…and N more" line. Entries past the writer's own cap are a value no writer
 * files: counted unread, never listed.
 *
 * Built from a real run on the mock (`code: 'match'` and the attachment),
 * JSON-round-tripped, then filled to the caps with well-formed entries.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { accountForAnswer } from '../../src/observe.js';
import { showLeaves } from '../../src/answer-account/shown.js';
import { MAX_LISTED_CALLS } from '../../src/answer-account/facts/checked.js';
import { FACT_TEXT_CHARS } from '../../src/answer-account/facts/common.js';
import { MAX_CODE_REGIONS } from '../../src/core/agent/evidence/codeRegions.js';
import { MAX_ATTACHED_SCRIPTS } from '../../src/core/agent/scripts/attachment.js';
import { scriptRowIsWellFormed } from '../../src/core/agent/scripts/rows.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import { filled, lastOf, matchedRecording, type Doc } from './fixtures/writerCaps.js';
import { utf8Bytes } from './helpers.js';

const idsOf = (account: ReturnType<typeof accountForAnswer>) =>
  account.rows.flatMap((r) => r.lines.map((l) => l.template.id));

describe('script lines within the account bound', () => {
  let recording: Recording;
  beforeAll(async () => {
    recording = await matchedRecording();
  });

  it('the fill is well-formed: every row is one the checkpoint door admits', () => {
    const doc = filled(recording, MAX_CODE_REGIONS, MAX_ATTACHED_SCRIPTS) as unknown as Doc;
    const rows = (doc.snapshot.sharedState.findingsLedger as Array<Record<string, unknown>>).filter(
      (r) => r.kind === 'script',
    );
    expect(rows.length).toBe(16);
    expect(rows.every((r) => scriptRowIsWellFormed(r))).toBe(true);
  });

  it('at the writer caps: within 128 KB (account) and 192 KB (response); the first five of each kind listed, then one line for the rest', () => {
    const at = filled(recording, MAX_CODE_REGIONS, MAX_ATTACHED_SCRIPTS);
    const account = accountForAnswer(at);
    const shown = showLeaves(account, at);
    expect(utf8Bytes(account)).toBeLessThanOrEqual(128 * 1024);
    expect(utf8Bytes({ account, shown })).toBeLessThanOrEqual(192 * 1024);
    const ids = idsOf(account);
    expect(ids.filter((id) => id === 'howSure.script.shown.completedWithFailure')).toHaveLength(
      MAX_LISTED_CALLS,
    );
    expect(ids.filter((id) => id === 'howSure.script.attached.completedWithFailure')).toHaveLength(
      MAX_LISTED_CALLS,
    );
    const texts = account.rows.flatMap((r) => r.lines.map((l) => l.text));
    expect(texts).toContain(
      `…and ${
        MAX_CODE_REGIONS - MAX_LISTED_CALLS
      } more scripts shown in the answer, not listed here.`,
    );
    expect(texts).toContain(
      `…and ${MAX_ATTACHED_SCRIPTS - MAX_LISTED_CALLS} more attached scripts, not listed here.`,
    );
    // Judged, not dropped: the "named under the answer" line counts every attached script.
    expect(texts).toContain(
      `${MAX_ATTACHED_SCRIPTS} attached scripts are named under the answer, not printed: the formatting above could have shown part of a program as ordinary text. The programs are on the record.`,
    );
    expect(account.unread).toBe(accountForAnswer(recording).unread);
  });

  it('past the writer caps: the extra entries are a value no writer files — counted unread, never listed', () => {
    const control = accountForAnswer(filled(recording, MAX_CODE_REGIONS, MAX_ATTACHED_SCRIPTS));
    const over = accountForAnswer(
      filled(recording, MAX_CODE_REGIONS + 1, MAX_ATTACHED_SCRIPTS + 1),
    );
    expect(over.unread).toBe(control.unread + 2);
    expect(idsOf(over)).toEqual(idsOf(control));
  });

  it('a tool name and a call id are cut at 200 characters in a script line, as in every line of the account', () => {
    const doc = JSON.parse(JSON.stringify(filled(recording, 1, 1))) as Doc;
    const long = 'z'.repeat(1_000);
    const block = (
      (lastOf(doc, 'agent.evidence_checked').payload.scripts as { blocks: unknown[] })
        .blocks as Array<Record<string, unknown>>
    )[0]!;
    block.toolCallId = long;
    block.tool = long;
    const shown = (lastOf(doc, 'agent.turn_end').payload.scripts as { shown: unknown[] })
      .shown as Array<Record<string, unknown>>;
    shown[0]!.toolCallId = long;
    shown[0]!.tool = long;
    const account = accountForAnswer(doc as unknown as Recording);
    const lines = account.rows
      .flatMap((r) => r.lines)
      .filter((l) =>
        /^howSure\.script\.(shown|attached)\.completedWithFailure$/.test(l.template.id),
      );
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      for (const name of ['tool', 'call'] as const) {
        const value = (line.vars as Record<string, { value: unknown; clipped?: true }>)[name]!;
        expect(String(value.value).length, name).toBe(FACT_TEXT_CHARS);
        expect(value.clipped, name).toBe(true);
      }
    }
  });

  it('a listing of five or fewer has no "…and more" line', () => {
    const account = accountForAnswer(filled(recording, MAX_LISTED_CALLS, MAX_LISTED_CALLS));
    const ids = idsOf(account);
    expect(ids).not.toContain('howSure.script.shown.more');
    expect(ids).not.toContain('howSure.script.attached.more');
    expect(ids.filter((id) => id === 'howSure.script.shown.completedWithFailure')).toHaveLength(
      MAX_LISTED_CALLS,
    );
  });
});
