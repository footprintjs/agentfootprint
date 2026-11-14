import { describe, expect, it } from 'vitest';
import type { TimeOptions } from '../../../../time/clock.js';
import { configureTime, type TimePort } from './configure.js';

describe('the builder time declaration', () => {
  it('refuses an ungrounded reader policy and an abbreviation before accepting a zone', () => {
    const receiver: TimePort = {};
    expect(() => configureTime(receiver, { policy: { dateOrder: 'MDY' } }, receiver)).toThrow(
      /arm a reader/,
    );
    expect(() => configureTime(receiver, { zone: 'PST' }, receiver)).toThrow(/zone/);
    expect(receiver.timeValue).toBeUndefined();
    configureTime(receiver, { zone: 'America/Chicago' }, receiver);
    expect(receiver.timeValue).toEqual({ zone: 'America/Chicago' });
  });

  it('refuses a second clock before consulting new options', () => {
    const receiver: TimePort = {};
    configureTime(receiver, undefined, receiver);
    const replacement: TimeOptions = {
      get zone(): never {
        throw new Error('replacement clock must not be read');
      },
    };
    expect(() => configureTime(receiver, replacement, receiver)).toThrow(/already set/);
    expect(receiver.timeValue).toEqual({});
  });
});
