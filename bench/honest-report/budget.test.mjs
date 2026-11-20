import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BudgetExceededError,
  createBudget,
  estimateInputTokens,
  FULL_EXPOSURE_UNITS,
  MAX_OUTPUT_TOKENS,
  PROJECTED_LIMIT_UNITS,
  SPEND_LIMIT_UNITS,
  toDollars,
  unitsFor,
} from './budget.mjs';

function ledger() {
  const events = [];
  return { events, budget: createBudget((event) => events.push(event)) };
}

const request = { inputBytes: 123, maxTokens: MAX_OUTPUT_TOKENS, task: 'example' };

test('high-tier accounting uses integer units and includes the tool allowance', () => {
  assert.equal(estimateInputTokens(123), 468);
  assert.equal(unitsFor(100, 200), 1_100);
  assert.equal(toDollars(FULL_EXPOSURE_UNITS), 0.51024);
  assert.equal(toDollars(PROJECTED_LIMIT_UNITS), 4);
  assert.equal(toDollars(SPEND_LIMIT_UNITS), 5);
});

test('final usage replaces the in-flight reservation and charges the full reported input', () => {
  const { events, budget } = ledger();
  const ticket = budget.reserve(request);
  assert.equal(Object.isFrozen(ticket), true);
  assert.equal(ticket.task, 'example');
  assert.equal(ticket.boundUnits, unitsFor(468, MAX_OUTPUT_TOKENS));
  assert.deepEqual(budget.snapshot(), {
    chargedUnits: 0, exposureUnits: FULL_EXPOSURE_UNITS, dispatches: 1, unknownUsage: 0, stopped: false,
  });

  const usage = { input: 600, output: 11 };
  assert.deepEqual(budget.settle(ticket, usage), {
    inputTokens: 600, outputTokens: 11, usageKnown: true, chargedUnits: 655,
  });
  assert.deepEqual(budget.snapshot(), {
    chargedUnits: 655, exposureUnits: 655, dispatches: 1, unknownUsage: 0, stopped: false,
  });
  assert.deepEqual(events.map((event) => event.type), ['dispatch', 'settle']);
  assert.deepEqual(events[1].usage, usage);
});

test('absent usage charges the byte estimate and holds the full exposure for future dispatches', () => {
  const { events, budget } = ledger();
  const first = budget.reserve(request);
  assert.deepEqual(budget.settle(first), {
    inputTokens: first.estimatedInputTokens,
    outputTokens: first.maxTokens,
    usageKnown: false,
    chargedUnits: first.boundUnits,
  });
  const second = budget.reserve(request);
  budget.settle(second, { input: 20, output: 2 });
  assert.deepEqual(budget.snapshot(), {
    chargedUnits: first.boundUnits + 30,
    exposureUnits: FULL_EXPOSURE_UNITS + 30,
    dispatches: 2,
    unknownUsage: 1,
    stopped: false,
  });
  assert.equal(events[1].usage, null);
});

test('an over-cap response settles conservatively and stops further dispatch', () => {
  const { events, budget } = ledger();
  const ticket = budget.reserve(request);
  assert.throws(() => budget.settle(ticket, { input: 200, output: MAX_OUTPUT_TOKENS + 1 }), {
    name: 'BudgetExceededError',
    settlement: {
      inputTokens: ticket.estimatedInputTokens, outputTokens: MAX_OUTPUT_TOKENS,
      usageKnown: false, chargedUnits: ticket.boundUnits,
    },
  });
  assert.deepEqual(budget.snapshot(), {
    chargedUnits: ticket.boundUnits, exposureUnits: FULL_EXPOSURE_UNITS, dispatches: 1, unknownUsage: 1, stopped: true,
  });
  assert.deepEqual(events.map((event) => event.type), ['dispatch', 'settle', 'budget-stop']);
  assert.throws(() => budget.reserve(request), BudgetExceededError);
  assert.equal(budget.snapshot().dispatches, 1);
});

test('unexpected cache use settles conservatively and stops further dispatch', () => {
  const { budget } = ledger();
  const ticket = budget.reserve(request);
  assert.throws(() => budget.settle(ticket, { input: 30, output: 2, cache_creation_input_tokens: 10 }), {
    name: 'BudgetExceededError', reason: 'usage outside the request contract',
  });
  assert.equal(budget.snapshot().chargedUnits, ticket.boundUnits);
  assert.equal(budget.snapshot().exposureUnits, FULL_EXPOSURE_UNITS);
});

test('a fabricated or already settled ticket cannot change the ledger', () => {
  const { events, budget } = ledger();
  const ticket = budget.reserve(request);
  assert.throws(() => budget.settle({ ...ticket }), TypeError);
  budget.settle(ticket, { input: 1, output: 0 });
  assert.throws(() => budget.settle(ticket), TypeError);
  assert.equal(budget.snapshot().chargedUnits, 1);
  assert.deepEqual(events.map((event) => event.type), ['dispatch', 'settle']);
});

test('a byte reservation above the spend limit records a stop without dispatching', () => {
  const { events, budget } = ledger();
  assert.throws(() => budget.reserve({ ...request, inputBytes: 20_000_000 }), {
    name: 'BudgetExceededError', reason: 'byte reservation exceeds the spend limit',
  });
  assert.deepEqual(events.map((event) => event.type), ['budget-stop']);
  assert.equal(budget.snapshot().dispatches, 0);
});

test('a second in-flight reservation is refused and the first ticket can still settle', () => {
  const { events, budget } = ledger();
  const ticket = budget.reserve(request);
  assert.throws(() => budget.reserve(request), {
    name: 'BudgetExceededError', reason: 'a request is already in flight',
  });
  budget.settle(ticket, { input: 7, output: 1 });
  assert.equal(budget.snapshot().chargedUnits, 12);
  assert.deepEqual(events.map((event) => event.type), ['dispatch', 'budget-stop', 'settle']);
});

test('repeated missing usage stops at the full-exposure ceiling even with small byte estimates', () => {
  const { events, budget } = ledger();
  for (let index = 0; index < 9; index += 1) {
    budget.settle(budget.reserve(request));
  }
  assert.throws(() => budget.reserve(request), {
    name: 'BudgetExceededError', reason: 'full exposure exceeds the spend limit',
  });
  assert.equal(budget.snapshot().dispatches, 9);
  assert.equal(budget.snapshot().exposureUnits, 9 * FULL_EXPOSURE_UNITS);
  assert.equal(budget.snapshot().unknownUsage, 9);
  assert.equal(events.at(-1).type, 'budget-stop');
});

test('a large inferred missing-usage charge also constrains subsequent full exposure', () => {
  const { budget } = ledger();
  budget.settle(budget.reserve({ ...request, inputBytes: 19_000_000 }));
  assert.throws(() => budget.reserve(request), {
    name: 'BudgetExceededError', reason: 'full exposure exceeds the spend limit',
  });
  assert.equal(budget.snapshot().dispatches, 1);
});

test('a dispatch can reserve exactly USD 5 in full exposure and no more', () => {
  for (const excessUnits of [0, 1]) {
    const { budget } = ledger();
    for (let index = 0; index < 8; index += 1) {
      budget.settle(budget.reserve(request), { input: 1_000_000, output: 0 });
    }
    budget.settle(budget.reserve(request), { input: 979_520 + excessUnits, output: 0 });
    if (excessUnits === 0) {
      budget.reserve(request);
      assert.equal(budget.snapshot().exposureUnits, SPEND_LIMIT_UNITS);
      assert.equal(budget.snapshot().dispatches, 10);
    } else {
      assert.throws(() => budget.reserve(request), {
        name: 'BudgetExceededError', reason: 'full exposure exceeds the spend limit',
      });
      assert.equal(budget.snapshot().dispatches, 9);
    }
  }
});
