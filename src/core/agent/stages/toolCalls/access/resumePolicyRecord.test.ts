import { describe, expect, it } from 'vitest';
import type { AskPayload, ToolMiddleware } from '../../../middleware/types.js';
import {
  fingerprintAskedQuestion,
  pausedGatePolicyOf,
  pauseGatePolicy,
} from './resumePolicyRecord.js';

const address = { gate: 'ask', iteration: 2, toolCallId: 'sample-call' } as const;
const question: AskPayload = {
  question: 'Which sample should be displayed?',
  detail: { choices: ['first', 'second'], defaultChoice: 'first' },
};

describe('paused tool policy provenance', () => {
  it('reads the policy requirements back at the exact pause address', () => {
    const middleware: ToolMiddleware = {
      name: 'choose-sample',
      onToolCall: () => ({ kind: 'ask', payload: question }),
    };
    const record = pauseGatePolicy({ toolMiddleware: [middleware] }, address, question);
    const stored = JSON.parse(JSON.stringify(record)) as unknown;

    expect(pausedGatePolicyOf(stored, address)).toEqual({
      ...address,
      permission: false,
      middleware: ['choose-sample'],
      question: fingerprintAskedQuestion(question),
    });
    expect(pausedGatePolicyOf(stored, { ...address, iteration: 3 })).toBeUndefined();
    expect(pausedGatePolicyOf(stored, { ...address, toolCallId: 'another-call' })).toBeUndefined();
    expect(pausedGatePolicyOf(stored, { ...address, gate: 'checkIn' })).toBeUndefined();
  });

  it('compares the whole question and ignores object property order', () => {
    const fingerprint = fingerprintAskedQuestion(question);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      fingerprintAskedQuestion({
        detail: { defaultChoice: 'first', choices: ['first', 'second'] },
        question: question.question,
      }),
    ).toBe(fingerprint);
    expect(
      fingerprintAskedQuestion({
        ...question,
        detail: { choices: ['first', 'second'], defaultChoice: 'second' },
      }),
    ).not.toBe(fingerprint);
    expect(fingerprintAskedQuestion({ ...question, question: 'Show both samples?' })).not.toBe(
      fingerprint,
    );
  });

  it('compares component questions by their immutable artifact tickets', () => {
    const component = { componentId: 'sample-picker', propsRef: 'art_sample_options' };
    const original = { ...question, component };
    const recorded = pauseGatePolicy({}, address, original);
    const restored = pausedGatePolicyOf(JSON.parse(JSON.stringify(recorded)), address);
    const fingerprint = restored?.question;

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintAskedQuestion({ ...original, component: { ...component } })).toBe(
      fingerprint,
    );
    expect(
      fingerprintAskedQuestion({
        ...original,
        component: { ...component, propsRef: 'art_new_sample_options' },
      }),
    ).not.toBe(fingerprint);
  });

  it('distinguishes a pause without a before-tool hook from missing provenance', () => {
    const checkIn = { ...address, gate: 'checkIn' } as const;
    const record = pauseGatePolicy({}, checkIn);
    expect(pausedGatePolicyOf(record, checkIn)).toEqual({
      ...checkIn,
      permission: false,
      middleware: [],
    });
    expect(pausedGatePolicyOf(undefined, checkIn)).toBeUndefined();
  });
});
