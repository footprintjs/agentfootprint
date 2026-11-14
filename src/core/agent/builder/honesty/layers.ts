import { answerLayerArm } from '../../assessment/answerLayerOptions.js';
import type { StandingLineWhen } from '../../assessment/compose.js';

export interface InputsLayerPort {
  inputsLayerValue: boolean;
  inputsLayerSourcesValue: boolean;
}

export interface ResultsLayerPort {
  resultsLayerValue: boolean;
}

export interface AnswerLayerPort {
  answerLayerValue?: { readonly standingLine?: StandingLineWhen };
}

export function configureInputsLayer<TReceiver extends InputsLayerPort>(
  self: TReceiver,
  options: { readonly argumentSources?: boolean } | undefined,
  original: object,
): object {
  if (self.inputsLayerValue) {
    throw new Error(
      'AgentBuilder.inputsLayer: already set. One agent mounts one inputs layer, over every ' +
        'ruled tool it can call — a second call has nothing left to add. Drop it.',
    );
  }
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    throw new Error(
      `AgentBuilder.inputsLayer: expected an options object or nothing, got ${typeof options}.`,
    );
  }
  const argumentSources = options?.argumentSources;
  if (argumentSources !== undefined && typeof argumentSources !== 'boolean') {
    throw new Error(
      `AgentBuilder.inputsLayer: argumentSources must be true or false, got ` +
        `${JSON.stringify(argumentSources)}.`,
    );
  }
  self.inputsLayerValue = true;
  self.inputsLayerSourcesValue = argumentSources === true;
  return original;
}

export function configureResultsLayer<TReceiver extends ResultsLayerPort>(
  self: TReceiver,
  original: object,
): object {
  if (self.resultsLayerValue) {
    throw new Error(
      'AgentBuilder.resultsLayer: already set. One agent mounts one results layer, over every ' +
        'call it runs — a second call has nothing left to add. Drop it.',
    );
  }
  self.resultsLayerValue = true;
  return original;
}

export function configureAnswerLayer<TReceiver extends AnswerLayerPort>(
  self: TReceiver,
  options:
    | {
        readonly standingLine?:
          | boolean
          | { readonly when: 'always' | 'unless-consistent' | 'not-sure-or-ask' };
      }
    | undefined,
  original: object,
): object {
  if (self.answerLayerValue !== undefined) {
    throw new Error(
      'AgentBuilder.answerLayer: already set. One agent folds one standing per answer — ' +
        'a second call has nothing left to add. Drop it (pass { standingLine: true } once).',
    );
  }
  if (options !== undefined && (typeof options !== 'object' || options === null)) {
    throw new Error(
      'AgentBuilder.answerLayer: options must be an object — ' +
        "{ standingLine?: boolean | { when: 'always' | 'unless-consistent' | 'not-sure-or-ask' } } " +
        '— or omitted.',
    );
  }
  self.answerLayerValue = answerLayerArm(options ?? {}, 'AgentBuilder.answerLayer');
  return original;
}
