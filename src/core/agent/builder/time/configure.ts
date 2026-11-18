import { readTimeOptions, type TimeOptions } from '../../../../time/clock.js';

export interface TimePort {
  timeValue?: TimeOptions;
}

export function configureTime<TReceiver extends TimePort>(
  self: TReceiver,
  options: TimeOptions | undefined,
  original: object,
): object {
  if (self.timeValue !== undefined) {
    throw new Error(
      'AgentBuilder.time: already set. One agent has one clock configuration — pass the ' +
        'fallback zone, the reader and its policy once.',
    );
  }
  const read = readTimeOptions(options);
  if ('problem' in read) throw new Error(`AgentBuilder.time: ${read.problem}.`);
  self.timeValue = read.value;
  return original;
}
