import { describe, expect, it } from 'vitest';
import { configureCheckIn, type CheckInPort } from './configure.js';

describe('check-in declaration', () => {
  it('retains the first option object and refuses another without replacing it', () => {
    const receiver: CheckInPort = {};
    const opts = {};
    expect(configureCheckIn(receiver, opts, receiver)).toBe(receiver);
    expect(receiver.checkInConfig).toBe(opts);
    expect(() => configureCheckIn(receiver, {}, receiver)).toThrow('already configured');
    expect(receiver.checkInConfig).toBe(opts);
  });
});
