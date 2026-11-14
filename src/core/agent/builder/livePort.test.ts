import { describe, expect, it } from 'vitest';
import { livePort } from './livePort.js';

describe('live builder capabilities', () => {
  it('reads and writes the current source only when the capability is used', () => {
    const events: string[] = [];
    let value = 1;
    const port = livePort<{ value: number }>({
      value: {
        get: () => {
          events.push('read');
          return value;
        },
        set: (next) => {
          events.push('write');
          value = next;
        },
      },
    });
    expect(events).toEqual([]);
    value = 2;
    expect(port.value).toBe(2);
    port.value = 3;
    expect(value).toBe(3);
    expect(port.value).toBe(3);
    expect(events).toEqual(['read', 'write', 'read']);
  });
});
