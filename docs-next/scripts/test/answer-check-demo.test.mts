import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAnswerCheckDemo } from '../../components/demos/answerCheckDemo';
import {
  ANSWER_CHECK_FIXTURES,
  ANSWER_CHECK_GAP,
} from '../../components/demos/answerCheckFixtures';

test('supported fixture actually executes one lookup and checks before delivery', async () => {
  const result = await runAnswerCheckDemo(ANSWER_CHECK_FIXTURES[0]);
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.checked, 3);
  assert.equal(result.report.resolvedRefs.length, 1);
  assert.equal(result.delivered, true);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.providerCalls, 2);
  assert.equal(result.draftChunks.length, 2, 'the provider really streamed a draft');
  assert.deepEqual(result.servedBeforeValidation, []);
  assert.match(result.customerAnswer, /records “completed”/);
  assert.ok(result.customerAnswer.endsWith(ANSWER_CHECK_GAP));
  assert.ok(result.turnEndContents.some((text) => text.includes('completed')));
});

test('missing lookup evidence withholds the confident draft and never counts as checked', async () => {
  const result = await runAnswerCheckDemo(ANSWER_CHECK_FIXTURES[1]);
  assert.equal(result.report.status, 'unverified');
  assert.equal(result.report.checked, 0);
  assert.equal(result.report.unreachable, 1);
  assert.equal(result.report.resolvedRefs.length, 0);
  assert.equal(result.delivered, false);
  assert.equal(result.toolCalls, 1, 'a check never reruns the lookup');
  assert.equal(result.providerCalls, 2);
  assert.match(result.draftChunks.join(''), /"status":"completed"/);
  assert.deepEqual(result.servedTokens, []);
  assert.ok(result.turnEndContents.every((text) => !text.includes('completed')));
  assert.match(result.customerAnswer, /I don’t know/);
  assert.match(result.customerAnswer, /no usable evidence/);
  assert.ok(result.customerAnswer.endsWith(ANSWER_CHECK_GAP));
});

test('a contradictory status fails the actual field comparison and is not delivered', async () => {
  const result = await runAnswerCheckDemo(ANSWER_CHECK_FIXTURES[2]);
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.checked, 3);
  assert.equal(result.report.failed, 1);
  assert.equal(
    result.report.checks.find((check) => check.id === 'refund-status')?.disposition,
    'checked-fail',
  );
  assert.equal(result.delivered, false);
  assert.deepEqual(result.servedTokens, []);
  assert.ok(result.turnEndContents.every((text) => !text.includes('completed')));
  assert.match(result.customerAnswer, /did not pass/);
  assert.ok(result.customerAnswer.endsWith(ANSWER_CHECK_GAP));
});

test('same-shaped evidence for the wrong customer or order fails', async () => {
  const supported = ANSWER_CHECK_FIXTURES[0];
  assert.ok(supported.evidence);
  for (const change of [{ customerId: 'customer-99' }, { orderId: 'B-1042' }]) {
    const result = await runAnswerCheckDemo({
      ...supported,
      evidence: { ...supported.evidence, ...change },
      draft: { ...supported.draft, ...change },
    });
    assert.equal(result.report.status, 'failed');
    assert.equal(
      result.report.checks.find((check) => check.id === 'customer-and-order')?.disposition,
      'checked-fail',
    );
    assert.equal(result.delivered, false);
    assert.deepEqual(result.servedTokens, []);
    assert.doesNotMatch(result.customerAnswer, /customer-99|B-1042/);
  }
});

test('stale, future or malformed read times cannot pass because the draft agrees', async () => {
  const supported = ANSWER_CHECK_FIXTURES[0];
  assert.ok(supported.evidence);
  for (const readAt of ['2026-01-14T12:00:00Z', '2026-01-16T12:00:00Z', 'not-a-date']) {
    const result = await runAnswerCheckDemo({
      ...supported,
      evidence: { ...supported.evidence, readAt },
      draft: { ...supported.draft, readAt },
    });
    assert.equal(result.report.status, 'failed');
    assert.equal(
      result.report.checks.find((check) => check.id === 'freshness')?.disposition,
      'checked-fail',
    );
    assert.equal(result.delivered, false);
    assert.deepEqual(result.servedTokens, []);
  }
});
