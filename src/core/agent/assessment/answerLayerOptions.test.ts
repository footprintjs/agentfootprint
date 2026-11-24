import { describe, expect, it } from 'vitest';
import {
  answerLayerArm,
  answerLayerFromOptions,
  type AnswerLayerOptions,
} from './answerLayerOptions.js';

describe('answer-layer choice and standing options', () => {
  it('allows a standing filter for a declared-source reason through either option door', () => {
    const options = {
      sourceNotConsulted: true,
      standingLine: { when: 'not-sure-or-ask', raiseOn: ['source-not-consulted'] },
    } satisfies AnswerLayerOptions;
    const arm = {
      sourceNotConsulted: true,
      standingLine: 'not-sure-or-ask',
      standingLineRaiseOn: ['source-not-consulted'],
    };

    expect(answerLayerArm(options, 'AgentBuilder.answerLayer')).toEqual(arm);
    expect(answerLayerFromOptions(options)).toEqual(arm);
  });

  it('keeps false and empty values independent', () => {
    expect(
      answerLayerFromOptions({
        sourceNotConsulted: false,
        standingLine: { when: 'always', raiseOn: [] },
      }),
    ).toEqual({ standingLine: 'always', standingLineRaiseOn: [] });
    expect(answerLayerFromOptions({ sourceNotConsulted: true, standingLine: false })).toEqual({
      sourceNotConsulted: true,
    });
  });
});
