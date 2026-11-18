import type { CheckInBuilderOptions } from '../../../checkin.js';

export interface CheckInPort {
  checkInConfig?: CheckInBuilderOptions;
}

export function configureCheckIn(
  self: CheckInPort,
  opts: CheckInBuilderOptions,
  original: object,
): object {
  if (self.checkInConfig !== undefined) {
    throw new Error('AgentBuilder.checkIn: already configured. Call it at most once.');
  }
  self.checkInConfig = opts;
  return original;
}
