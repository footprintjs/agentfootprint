import type { RunConfigFn } from '../../types.js';

export interface RunConfigurationPort {
  runConfigFn?: RunConfigFn;
}

export function setRunConfiguration(
  self: RunConfigurationPort,
  fn: RunConfigFn,
  original: object,
): object {
  if (self.runConfigFn) {
    throw new Error(
      'AgentBuilder.configure: already set. One resolver per agent — a second one would ' +
        'silently override the first.',
    );
  }
  if (typeof fn !== 'function') {
    throw new Error(
      `AgentBuilder.configure: expected a function (ctx) => ({ model?, instructions? }), got ` +
        `${typeof fn}.`,
    );
  }
  self.runConfigFn = fn;
  return original;
}
