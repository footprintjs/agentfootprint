import { describe, it, expect, vi } from 'vitest';
import {
  QualityRecorder,
  GuardrailRecorder,
  CompositeRecorder,
  TokenRecorder,
  TurnRecorder,
} from '../../src/recorders';
import type { TurnCompleteEvent, TurnStartEvent, LLMCallEvent } from '../../src/core';

// ── Helpers ─────────────────────────────────────────────────

function turnComplete(overrides: Partial<TurnCompleteEvent> = {}): TurnCompleteEvent {
  return {
    turnNumber: 0,
    messageCount: 2,
    totalLoopIterations: 1,
    content: 'Hello world',
    ...overrides,
  };
}

// ── QualityRecorder ─────────────────────────────────────────

describe('QualityRecorder', () => {
  it('records quality scores on turn complete', () => {
    const recorder = new QualityRecorder((event) => ({
      score: event.content.length > 5 ? 0.9 : 0.3,
      turnNumber: event.turnNumber,
    }));

    recorder.onTurnComplete(turnComplete({ content: 'Great response', turnNumber: 0 }));
    recorder.onTurnComplete(turnComplete({ content: 'OK', turnNumber: 1 }));

    const scores = recorder.getScores();
    expect(scores).toHaveLength(2);
    expect(scores[0].score).toBe(0.9);
    expect(scores[1].score).toBe(0.3);
  });

  it('computes average score', () => {
    const recorder = new QualityRecorder((event) => ({
      score: event.turnNumber === 0 ? 0.8 : 0.6,
      turnNumber: event.turnNumber,
    }));

    recorder.onTurnComplete(turnComplete({ turnNumber: 0 }));
    recorder.onTurnComplete(turnComplete({ turnNumber: 1 }));

    expect(recorder.getAverageScore()).toBe(0.7);
  });

  it('returns 0 average when no scores', () => {
    const recorder = new QualityRecorder(() => ({ score: 1, turnNumber: 0 }));
    expect(recorder.getAverageScore()).toBe(0);
  });

  it('supports labels', () => {
    const recorder = new QualityRecorder((event) => ({
      score: 0.9,
      label: 'excellent',
      turnNumber: event.turnNumber,
    }));

    recorder.onTurnComplete(turnComplete());
    expect(recorder.getScores()[0].label).toBe('excellent');
  });

  it('handles async judge (fire-and-forget)', async () => {
    const recorder = new QualityRecorder(async (event) => ({
      score: 0.95,
      turnNumber: event.turnNumber,
    }));

    recorder.onTurnComplete(turnComplete());
    // Wait for async to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(recorder.getScores()).toHaveLength(1);
  });

  it('clear resets scores', () => {
    const recorder = new QualityRecorder((e) => ({ score: 1, turnNumber: e.turnNumber }));
    recorder.onTurnComplete(turnComplete());
    recorder.clear();
    expect(recorder.getScores()).toHaveLength(0);
  });
});

// ── GuardrailRecorder ───────────────────────────────────────

describe('GuardrailRecorder', () => {
  it('records violations when check returns one', () => {
    const recorder = new GuardrailRecorder((event) => {
      if (event.content.includes('CONFIDENTIAL')) {
        return { rule: 'pii-leak', message: 'PII detected', turnNumber: event.turnNumber };
      }
      return null;
    });

    recorder.onTurnComplete(turnComplete({ content: 'CONFIDENTIAL data' }));
    recorder.onTurnComplete(turnComplete({ content: 'Safe content' }));

    expect(recorder.hasViolations()).toBe(true);
    expect(recorder.getViolations()).toHaveLength(1);
    expect(recorder.getViolations()[0].rule).toBe('pii-leak');
  });

  it('no violations when check returns null', () => {
    const recorder = new GuardrailRecorder(() => null);
    recorder.onTurnComplete(turnComplete());
    expect(recorder.hasViolations()).toBe(false);
  });

  it('supports severity levels', () => {
    const recorder = new GuardrailRecorder((event) => ({
      rule: 'tone',
      message: 'Informal tone',
      severity: 'info',
      turnNumber: event.turnNumber,
    }));

    recorder.onTurnComplete(turnComplete());
    expect(recorder.getViolations()[0].severity).toBe('info');
  });

  it('filters violations by rule', () => {
    const recorder = new GuardrailRecorder((event) => ({
      rule: event.turnNumber === 0 ? 'pii' : 'tone',
      message: 'violation',
      turnNumber: event.turnNumber,
    }));

    recorder.onTurnComplete(turnComplete({ turnNumber: 0 }));
    recorder.onTurnComplete(turnComplete({ turnNumber: 1 }));

    expect(recorder.getViolationsByRule('pii')).toHaveLength(1);
    expect(recorder.getViolationsByRule('tone')).toHaveLength(1);
    expect(recorder.getViolationsByRule('unknown')).toHaveLength(0);
  });

  it('handles async check', async () => {
    const recorder = new GuardrailRecorder(async (event) => ({
      rule: 'async-check',
      message: 'Found issue',
      turnNumber: event.turnNumber,
    }));

    recorder.onTurnComplete(turnComplete());
    await new Promise((r) => setTimeout(r, 10));
    expect(recorder.hasViolations()).toBe(true);
  });

  it('clear resets violations', () => {
    const recorder = new GuardrailRecorder((e) => ({
      rule: 'r',
      message: 'm',
      turnNumber: e.turnNumber,
    }));
    recorder.onTurnComplete(turnComplete());
    recorder.clear();
    expect(recorder.hasViolations()).toBe(false);
  });
});

// ── CompositeRecorder ───────────────────────────────────────

describe('CompositeRecorder', () => {
  it('dispatches events to all child recorders', () => {
    const turn = new TurnRecorder();
    const quality = new QualityRecorder((e) => ({ score: 1, turnNumber: e.turnNumber }));

    const composite = new CompositeRecorder([turn, quality]);

    composite.onTurnStart({ turnNumber: 0, message: 'hi' });
    composite.onTurnComplete(turnComplete({ turnNumber: 0 }));

    expect(turn.getTurns()).toHaveLength(1);
    expect(quality.getScores()).toHaveLength(1);
  });

  it('error in one recorder does not affect others', () => {
    const badRecorder = {
      id: 'bad',
      onTurnComplete: () => {
        throw new Error('boom');
      },
    };
    const goodRecorder = new TurnRecorder();

    const composite = new CompositeRecorder([badRecorder, goodRecorder]);

    // Should not throw
    composite.onTurnStart({ turnNumber: 0, message: 'hi' });
    composite.onTurnComplete(turnComplete());

    expect(goodRecorder.getCompletedCount()).toBe(1);
  });

  it('dispatches LLM call events', () => {
    const token = new TokenRecorder();
    const composite = new CompositeRecorder([token]);

    const llmEvent: LLMCallEvent = {
      model: 'gpt-4',
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 200,
      turnNumber: 0,
      loopIteration: 0,
    };

    composite.onLLMCall(llmEvent);
    expect(token.getStats().totalCalls).toBe(1);
  });

  it('clear calls clear on all children', () => {
    const turn = new TurnRecorder();
    const quality = new QualityRecorder((e) => ({ score: 1, turnNumber: e.turnNumber }));
    const composite = new CompositeRecorder([turn, quality]);

    composite.onTurnStart({ turnNumber: 0, message: 'hi' });
    composite.onTurnComplete(turnComplete());

    composite.clear();
    expect(turn.getTurns()).toHaveLength(0);
    expect(quality.getScores()).toHaveLength(0);
  });

  it('getRecorders returns child recorders', () => {
    const turn = new TurnRecorder();
    const composite = new CompositeRecorder([turn]);
    expect(composite.getRecorders()).toContain(turn);
  });
});
