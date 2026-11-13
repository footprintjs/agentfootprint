import { describe, expect, it } from 'vitest';
import {
  configureAnswerLayer,
  configureInputsLayer,
  configureResultsLayer,
  type AnswerLayerPort,
  type InputsLayerPort,
  type ResultsLayerPort,
} from './layers.js';

describe('the builder honesty layer declarations', () => {
  it('refuses malformed argument-source options before arming the inputs layer', () => {
    const receiver: InputsLayerPort = { inputsLayerValue: false, inputsLayerSourcesValue: false };
    const invalid = { argumentSources: 'yes' } as unknown as { argumentSources?: boolean };
    expect(() => configureInputsLayer(receiver, invalid, receiver)).toThrow(/true or false/);
    expect(receiver.inputsLayerValue).toBe(false);
    configureInputsLayer(receiver, { argumentSources: true }, receiver);
    const replacement = {
      get argumentSources(): boolean {
        throw new Error('duplicate options must not be read');
      },
    };
    expect(() => configureInputsLayer(receiver, replacement, receiver)).toThrow(/already set/);
    expect(receiver.inputsLayerSourcesValue).toBe(true);
  });

  it('arms results without changing an independently configured inputs layer', () => {
    const receiver: InputsLayerPort & ResultsLayerPort = {
      inputsLayerValue: false,
      inputsLayerSourcesValue: false,
      resultsLayerValue: false,
    };
    configureResultsLayer(receiver, receiver);
    configureInputsLayer(receiver, undefined, receiver);
    expect(() => configureResultsLayer(receiver, receiver)).toThrow(/already set/);
    expect(receiver).toEqual({
      inputsLayerValue: true,
      inputsLayerSourcesValue: false,
      resultsLayerValue: true,
    });
  });

  it('preserves the declared standing-line grammar for booleans and the selective modes', () => {
    const cases = [
      [true, { standingLine: 'always' }],
      [false, {}],
      [{ when: 'unless-consistent' }, { standingLine: 'unless-consistent' }],
      [{ when: 'not-sure-or-ask' }, { standingLine: 'not-sure-or-ask' }],
    ] as const;
    for (const [standingLine, expected] of cases) {
      const receiver: AnswerLayerPort = {};
      configureAnswerLayer(receiver, { standingLine }, receiver);
      expect(receiver.answerLayerValue).toEqual(expected);
      expect(() => configureAnswerLayer(receiver, undefined, receiver)).toThrow(/already set/);
    }
  });

  it('refuses an unknown answer option without consuming the declaration', () => {
    const receiver: AnswerLayerPort = {};
    const invalid = { standingLine: { when: 'always' as const, guessed: true } };
    expect(() => configureAnswerLayer(receiver, invalid, receiver)).toThrow(
      /unknown option.*guessed/,
    );
    expect(receiver.answerLayerValue).toBeUndefined();
    configureAnswerLayer(receiver, undefined, receiver);
    expect(receiver.answerLayerValue).toEqual({});
  });
});
