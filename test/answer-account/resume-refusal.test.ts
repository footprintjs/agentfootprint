import { describe, expect, it } from 'vitest';

import { accountForAnswer } from '../../src/answer-account/account.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import { assertP1 } from './helpers.js';

function event(type: string, payload: Record<string, unknown>) {
  return { type: `agentfootprint.${type}`, payload, meta: { runId: 'sample-run' } };
}

function resumedRecording(...decisions: ReturnType<typeof event>[]): Recording {
  return {
    structure: undefined,
    snapshot: {
      sharedState: { history: [{ role: 'tool', toolCallId: 'c1', toolName: 'lookup' }] },
    },
    events: [
      event('pause.resume', {}),
      ...decisions,
      event('stream.tool_end', {
        toolCallId: 'c1',
        toolName: 'lookup',
        entered: false,
        error: true,
      }),
    ] as Recording['events'],
  };
}

const middleware = (payload: Record<string, unknown>) =>
  event('middleware.decision', {
    middleware: 'sample-link',
    moment: 'before-tool',
    toolCallId: 'c1',
    toolName: 'lookup',
    ...payload,
  });

const permission = (payload: Record<string, unknown>) =>
  event('permission.check', { toolCallId: 'c1', target: 'lookup', phase: 'resume', ...payload });

function read(recording: Recording) {
  const account = accountForAnswer(recording);
  assertP1(account, recording, {});
  return { account, checked: account.rows.find((row) => row.id === 'checked')?.lines[0]?.text };
}

describe('the answer account for a refused policy recheck', () => {
  it('keeps the human approval and the middleware refusal in order', () => {
    const { account, checked } = read(
      resumedRecording(
        middleware({ outcome: 'allow', personApproved: true }),
        middleware({ outcome: 'deny', phase: 'resume' }),
      ),
    );
    expect(account.facts.calls[0]).toMatchObject({ outcome: 'refused', refusedBy: 'sample-link' });
    expect(account.facts.errors).toMatchObject({ refused: 1, declined: 0 });
    expect(checked).toBe(
      'A person approved the call to lookup, then the rule named sample-link refused it.',
    );
  });

  it.each(['deny', 'halt'])(
    'reads a permission %s without borrowing another call’s verdict',
    (result) => {
      const { account, checked } = read(
        resumedRecording(
          event('checkin.decision', { toolCallId: 'c1', approved: true }),
          permission({ toolCallId: 'another-call', result, policyRuleId: 'unrelated-rule' }),
          permission({ result, policyRuleId: 'sample-rule' }),
        ),
      );
      expect(account.facts.calls[0]).toMatchObject({
        outcome: 'refused',
        refusedBy: 'sample-rule',
      });
      expect(account.facts.errors).toMatchObject({ refused: 1, declined: 0 });
      expect(checked).toBe(
        'A person approved the call to lookup, then the rule named sample-rule refused it.',
      );
    },
  );

  it('attributes a library refusal to the library after a recorded approval', () => {
    const { account, checked } = read(
      resumedRecording(
        middleware({ outcome: 'allow', personApproved: true }),
        middleware({ outcome: 'refused', phase: 'resume' }),
      ),
    );
    expect(account.facts.errors).toMatchObject({ refused: 1, declined: 0 });
    expect(checked).toBe('A person approved the call to lookup, then the library refused it.');
  });

  it('records a refusal even when no human answer is on the record', () => {
    const { account, checked } = read(
      resumedRecording(middleware({ outcome: 'deny', phase: 'resume' })),
    );
    expect(account.facts.errors).toMatchObject({ refused: 1, declined: 0 });
    expect(checked).toBe('It asked to run lookup, and a rule named sample-link refused it.');
  });

  it('names the library without treating an unmarked allow as a human answer', () => {
    const { account, checked } = read(
      resumedRecording(
        middleware({ outcome: 'allow', why: 'approved by a person' }),
        middleware({ outcome: 'refused', phase: 'resume' }),
      ),
    );
    expect(account.facts.calls[0]).toMatchObject({ outcome: 'refused', refusedBy: 'library' });
    expect(checked).toBe(
      'It asked to run lookup, and the library refused it when the call resumed.',
    );
  });
});
