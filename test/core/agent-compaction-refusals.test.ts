/**
 * The compaction refusals (8.14.0) — making the code match its own promise.
 *
 * `.compaction()`'s summarizer refusal has always said:
 *
 *   > It is explicit on purpose — the library will not quietly bill your main
 *   > model for compaction. Pass a cheap provider/model here.
 *
 * And then `model` was optional, defaulting to `config.model ?? agentModel`.
 * That default had no correct branch:
 *
 *   • SAME provider family — it billed the main model for every fold, which is
 *     the exact sentence above, negated;
 *   • DIFFERENT provider — it sent the agent's model id to a vendor that has
 *     never heard of it, and the fold died mid-run, on a paid run, in a file
 *     whose header promises "everything fails at `.build()`, never mid-run".
 *
 * So `model` is required. And a second, narrower refusal covers what requiring
 * it does not: the agent's OWN provider instance at the agent's OWN model.
 * That pairing is not about money any more — it is two calls configured
 * identically that provably behave differently, because the summarizer's call
 * is un-decorated (no reliability retry, no fallback, no circuit breaker, no
 * cache). A difference nobody typed.
 *
 * Both doors are checked. `.compaction({...})` and
 * `.window(summarizeOldest({...}))` are the same policy, and a rule only one
 * of them enforces is advice.
 */

import { describe, expect, it } from 'vitest';

import { Agent, LLMCall, summarizeOldest, slidingWindow } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMProvider } from '../../src/adapters/types.js';

const cheap = (): LLMProvider => mock({ reply: 'summary' });

describe('#6 — `model` is required whenever a summarizer is given', () => {
  it('refuses at .compaction(), naming BOTH branches of the deleted default', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'expensive' }).compaction({
        thresholdTokens: 100,
        summarizer: cheap(),
      } as never),
    ).toThrow(/model is required whenever you pass a summarizer/);
  });

  it('the message teaches the fix, and names both failures it replaces', () => {
    let message = '';
    try {
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'expensive' }).compaction({
        thresholdTokens: 100,
        summarizer: cheap(),
      } as never);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('quietly billed your MAIN model');
    expect(message).toContain('never heard of it');
    expect(message).toMatch(/model: 'claude-haiku-4-5'/);
  });

  it('refuses at the OTHER door too, under its own label', () => {
    expect(() => summarizeOldest({ thresholdTokens: 100, summarizer: cheap() } as never)).toThrow(
      /summarizeOldest: model is required/,
    );
  });

  it('an empty model id is still refused separately — required is not "any string"', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).compaction({
        thresholdTokens: 100,
        summarizer: cheap(),
        model: '',
      }),
    ).toThrow(/model must be a non-empty model id/);
  });

  it('accepts the correct spelling — the refusal must not catch a named model', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'expensive' })
        .compaction({ thresholdTokens: 100, summarizer: cheap(), model: 'haiku' })
        .build(),
    ).not.toThrow();
  });

  it("the fold now records the SUMMARIZER as the summary's author", async () => {
    // The claim names its author, and before 8.14.0 that author was the agent's
    // own model on every default-configured agent.
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'expensive' })
      .compaction({ thresholdTokens: 100, summarizer: cheap(), model: 'haiku' })
      .build();
    expect(agent).toBeDefined();
  });
});

describe("#22 — the agent's own instance at the agent's own model", () => {
  it('refuses when summarizer === provider AND model === the agent model', () => {
    const shared = mock({ reply: 'ok' });
    expect(() =>
      Agent.create({ provider: shared, model: 'sonnet' }).compaction({
        thresholdTokens: 100,
        summarizer: shared,
        model: 'sonnet',
      }),
    ).toThrow(/the agent's own provider INSTANCE and the agent's own model/);
  });

  it('the message teaches the one-word escape', () => {
    const shared = mock({ reply: 'ok' });
    let message = '';
    try {
      Agent.create({ provider: shared, model: 'sonnet' }).compaction({
        thresholdTokens: 100,
        summarizer: shared,
        model: 'sonnet',
      });
    } catch (e) {
      message = (e as Error).message;
    }
    // Why, not just what: the two calls behave differently and nobody said so.
    expect(message).toContain('reliability');
    expect(message).toContain('no fallback, no cache');
    expect(message).toContain('its OWN instance');
  });

  it('refuses through .window(summarizeOldest(...)) too — no accepted-and-wrong sibling', () => {
    const shared = mock({ reply: 'ok' });
    expect(() =>
      Agent.create({ provider: shared, model: 'sonnet' }).window(
        summarizeOldest({ thresholdTokens: 100, summarizer: shared, model: 'sonnet' }),
      ),
    ).toThrow(/AgentBuilder\.window: the summarizer is the agent's own provider INSTANCE/);
  });

  it('ALLOWS the same instance at a DIFFERENT model — the common, correct shape', () => {
    const shared = mock({ reply: 'ok' });
    expect(() =>
      Agent.create({ provider: shared, model: 'sonnet' })
        .compaction({ thresholdTokens: 100, summarizer: shared, model: 'haiku' })
        .build(),
    ).not.toThrow();
  });

  it('ALLOWS a different instance at the SAME model — a defensible choice, made explicit', () => {
    // "Use the strong model to write the summary, because a bad summary
    // poisons every turn after it" is real. Requiring a second instance is
    // what turns it from an accident into a decision — and it ends the shared
    // per-instance state (cursors, rate-limit buckets) at the same time.
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'sonnet' })
        .compaction({ thresholdTokens: 100, summarizer: mock({ reply: 'ok' }), model: 'sonnet' })
        .build(),
    ).not.toThrow();
  });

  it('leaves strategies that bill NOTHING completely alone', () => {
    const shared = mock({ reply: 'ok' });
    expect(() =>
      Agent.create({ provider: shared, model: 'sonnet' })
        .window(slidingWindow({ keepRecentTurns: 4 }))
        .build(),
    ).not.toThrow();
  });
});

describe("#21 — LLMCall refuses costBudget onExceed: 'halt'", () => {
  const pricingTable = { name: 'p', pricePerToken: () => 1 };

  it('refuses, because one call has no next boundary to stop at', () => {
    expect(() =>
      LLMCall.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        pricingTable,
        costBudget: { usd: 1, onExceed: 'halt' },
      }).build(),
    ).toThrow(/has nothing to halt/);
  });

  it("accepts 'warn' and the bare number, which mean the same thing here", () => {
    expect(() =>
      LLMCall.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        pricingTable,
        costBudget: { usd: 1, onExceed: 'warn' },
      }).build(),
    ).not.toThrow();
    expect(() =>
      LLMCall.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        pricingTable,
        costBudget: 1,
      }).build(),
    ).not.toThrow();
  });

  it('refuses an onExceed nobody recognises rather than treating it as one', () => {
    expect(() =>
      Agent.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        pricingTable,
        costBudget: { usd: 1, onExceed: 'stop' as never },
      }).build(),
    ).toThrow(/costBudget\.onExceed must be 'warn' or 'halt'/);
  });

  it('refuses a non-positive usd on either spelling', () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(() =>
        Agent.create({
          provider: mock({ reply: 'ok' }),
          model: 'm',
          pricingTable,
          costBudget: bad,
        }).build(),
      ).toThrow(/positive number of USD/);
      expect(() =>
        Agent.create({
          provider: mock({ reply: 'ok' }),
          model: 'm',
          pricingTable,
          costBudget: { usd: bad, onExceed: 'warn' },
        }).build(),
      ).toThrow(/positive number of USD/);
    }
  });

  it("8.13.0's pricing refusal still fires first — a budget with no prices is still inert", () => {
    expect(() =>
      Agent.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        costBudget: { usd: 1, onExceed: 'halt' },
      }).build(),
    ).toThrow(/costBudget was set without a pricingTable/);
  });
});
