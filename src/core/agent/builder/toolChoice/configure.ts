import type { AgentOptions } from '../../types.js';

export interface ToolChoicePort {
  toolChoiceValue?: NonNullable<AgentOptions['toolChoice']>;
}

export function configureToolChoice(
  self: ToolChoicePort,
  options: NonNullable<AgentOptions['toolChoice']>,
  original: object,
): object {
  if (self.toolChoiceValue !== undefined) {
    throw new Error(
      'AgentBuilder.toolChoice: already set. One classifier per agent — a second call would ' +
        'leave two option sets with the later one silently winning. Pass every option in the ' +
        'one call.',
    );
  }
  if (options === null || typeof options !== 'object') {
    throw new Error(`AgentBuilder.toolChoice: expected an options object, got ${typeof options}.`);
  }
  const classifier = options.classifier;
  if (
    classifier === null ||
    typeof classifier !== 'object' ||
    typeof classifier.name !== 'string' ||
    classifier.name === '' ||
    typeof classifier.classify !== 'function'
  ) {
    throw new Error(
      'AgentBuilder.toolChoice: classifier must be a Classifier — `{ name: string; ' +
        'classify(request, signal?) }` from agentfootprint/classify (`typesafe()`, ' +
        '`mockClassifier()`, or your own).',
    );
  }
  const serve = options.serve ?? 'all';
  if (serve !== 'all') {
    const top = serve !== null && typeof serve === 'object' ? serve.top : undefined;
    if (!(Number.isInteger(top) && (top as number) >= 1)) {
      throw new Error(
        `AgentBuilder.toolChoice: serve must be 'all' or { top: <integer ≥ 1> }, got ` +
          `${JSON.stringify(serve)}.`,
      );
    }
  }
  const alwaysServe = options.alwaysServe;
  if (
    alwaysServe !== undefined &&
    (!Array.isArray(alwaysServe) || alwaysServe.some((n) => typeof n !== 'string' || n === ''))
  ) {
    throw new Error(
      'AgentBuilder.toolChoice: alwaysServe must be an array of non-empty tool names, got ' +
        `${JSON.stringify(alwaysServe)}.`,
    );
  }
  self.toolChoiceValue = {
    classifier,
    serve,
    ...(alwaysServe !== undefined && { alwaysServe: [...alwaysServe] }),
  };
  return original;
}
