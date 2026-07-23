/**
 * The coworker with the receipts — tests for the flagship check-in demo
 * (`examples/features/34-checkin-coworker.ts`). Drives the demo's
 * non-interactive paths so the demo can never rot:
 *
 *   • mock default → the run pauses BEFORE the consequential post, carrying a
 *     full evidence pack (willDo / read / drivers / trail).
 *   • --approve → the post executes; the audit tallies one approval.
 *   • --decline → nothing is posted, the model ADAPTS (keeps a draft), and the
 *     audit tallies one decline with the note.
 *   • the CheckInRecorder tally + the receipts renderer.
 */

import { describe, it, expect } from 'vitest';
import { checkInApproved, checkInDeclined } from '../../../src/index.js';
import {
  runDemo,
  assembleStatusDoc,
  renderReceipts,
  renderAudit,
  WORK_REQUEST,
} from '../../../examples/features/34-checkin-coworker.js';

const APPROVE = { decide: () => checkInApproved({ by: 'alice@ops', note: 'verified' }) };
const DECLINE = { decide: () => checkInDeclined({ by: 'bob@ops', note: 'not this week' }) };

describe('coworker demo — the check-in pauses before the consequential action', () => {
  it('pauses BEFORE post_to_channel and carries a full evidence pack', async () => {
    const out = await runDemo(APPROVE);

    expect(out.paused).toBe(true);
    expect(out.request?.tool).toBe('post_to_channel');
    // The receipts.
    const ev = out.request!.evidence;
    expect(ev.willDo).toContain('team channel');
    expect(ev.willDo).toContain('#team-updates');

    // READ — what the run consumed: system rules + the task + prior results.
    const channels = new Set((ev.read ?? []).map((f) => f.channel));
    expect(channels).toEqual(new Set(['system', 'task', 'result']));
    // By the time it posts, it has read context AND saved a draft.
    const resultSummaries = (ev.read ?? []).filter((f) => f.channel === 'result');
    expect(resultSummaries).toHaveLength(2);

    // DRIVERS — ranked most-to-least; the task drove the pick hardest.
    const drivers = ev.drivers ?? [];
    expect(drivers.length).toBeGreaterThan(0);
    for (let i = 1; i < drivers.length; i++) {
      expect(drivers[i - 1].score).toBeGreaterThanOrEqual(drivers[i].score);
    }
    expect(drivers[0].channel).toBe('task');

    // TRAIL — the two safe tools already ran, both ok.
    expect(ev.trail?.toolCalls.map((t) => t.name)).toEqual(['read_context', 'save_draft']);
    expect(ev.trail?.toolCalls.every((t) => t.ok)).toBe(true);
  });

  it('the deliverable is a real markdown status doc assembled from the notes', () => {
    const doc = assembleStatusDoc();
    expect(doc).toContain('# Weekly Status');
    expect(doc).toContain('## Shipped');
    expect(doc).toContain('Checkout redesign');
    expect(doc).toContain('Signups +12%');
    expect(doc).toContain('SEV-3');
  });
});

describe('coworker demo — APPROVE runs the tool', () => {
  it('posts to the channel and the audit tallies one approval', async () => {
    const out = await runDemo(APPROVE);

    expect(out.decision?.approved).toBe(true);
    expect(out.workspace.posts).toHaveLength(1);
    expect(out.workspace.posts[0].channel).toBe('#team-updates');
    expect(out.workspace.drafts).toHaveLength(1); // the one pre-post draft
    expect(out.finalText).toContain('Posted');

    expect(out.audit.getStats()).toEqual({ requested: 1, approved: 1, declined: 0, pending: 0 });
    expect(out.audit.getDecisions()[0]).toMatchObject({
      toolName: 'post_to_channel',
      approved: true,
      by: 'alice@ops',
    });
  });
});

describe('coworker demo — DECLINE is model-visible; the coworker adapts', () => {
  it('posts nothing, keeps a second draft, and finishes without the post', async () => {
    const out = await runDemo(DECLINE);

    expect(out.decision?.approved).toBe(false);
    expect(out.workspace.posts).toHaveLength(0); // nothing posted
    // Adaptation: after seeing "declined by human", it saves a HELD draft.
    expect(out.workspace.drafts).toHaveLength(2);
    expect(out.workspace.drafts[1].title).toContain('held for review');
    expect(out.finalText.toLowerCase()).toContain('did not post');

    expect(out.audit.getStats()).toEqual({ requested: 1, approved: 0, declined: 1, pending: 0 });
    expect(out.audit.getDecisions()[0]).toMatchObject({
      toolName: 'post_to_channel',
      approved: false,
      by: 'bob@ops',
      note: 'not this week',
    });
  });
});

describe('coworker demo — the receipts render for a human', () => {
  it('renderReceipts shows the four evidence sections in plain words', async () => {
    const out = await runDemo(APPROVE);
    const receipts = renderReceipts(out.request!, { color: false });

    expect(receipts).toContain('CHECK-IN');
    expect(receipts).toContain('WILL DO');
    expect(receipts).toContain('READ');
    expect(receipts).toContain('WHAT DROVE THIS');
    expect(receipts).toContain('TRAIL');
    expect(receipts).toContain('post_to_channel');
    // No stray ANSI escapes when color is off (pipe-safe).
    expect(receipts).not.toContain('\x1b[');
  });

  it('renderAudit tallies the decision with by/note', async () => {
    const out = await runDemo(DECLINE);
    const audit = renderAudit(out.audit, { color: false });

    expect(audit).toContain('AUDIT TRAIL');
    expect(audit).toContain('declined 1');
    expect(audit).toContain('post_to_channel');
    expect(audit).toContain('bob@ops');
    expect(audit).toContain('not this week');
  });
});

describe('coworker demo — sanity', () => {
  it('the work request is the one-liner job', () => {
    expect(WORK_REQUEST).toMatch(/weekly status/i);
    expect(WORK_REQUEST).toMatch(/post/i);
  });
});
