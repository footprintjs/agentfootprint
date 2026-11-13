import { describe, expect, it } from 'vitest';
import { mockClassifier } from '../../../../classify/mock.js';
import { configureToolChoice, type ToolChoicePort } from './configure.js';

describe('tool-choice declaration', () => {
  it('copies caller names without calling or replacing the classifier', () => {
    const receiver: ToolChoicePort = {};
    const classifier = mockClassifier([]);
    const alwaysServe = ['search'];
    expect(
      configureToolChoice(receiver, { classifier, alwaysServe, serve: { top: 1 } }, receiver),
    ).toBe(receiver);
    alwaysServe.push('later');
    expect(receiver.toolChoiceValue?.alwaysServe).toEqual(['search']);
    expect(receiver.toolChoiceValue?.classifier).toBe(classifier);
    expect(classifier.calls).toHaveLength(0);
  });

  it('refuses a second declaration before reading its classifier', () => {
    const classifier = mockClassifier([]);
    const receiver: ToolChoicePort = { toolChoiceValue: { classifier } };
    expect(() =>
      configureToolChoice(
        receiver,
        {
          get classifier(): never {
            throw new Error('incoming classifier was read');
          },
        },
        receiver,
      ),
    ).toThrow('already set');
    expect(receiver.toolChoiceValue?.classifier).toBe(classifier);
  });
});
