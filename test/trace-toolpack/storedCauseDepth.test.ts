import { describe, expect, it } from 'vitest';
import { copyJson } from '../../src/lib/boundedJson.js';

function nested(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index++) value = { next: value };
  return value;
}

describe('history copy uses the producer depth without weakening older boundaries', () => {
  it('retains the existing 100-level default', () => {
    expect(() => copyJson(nested(100), 100_000, true)).not.toThrow();
    expect(() => copyJson(nested(101), 100_000, true)).toThrow('JSON nesting limit');
  });
  it('accepts the public producer depth only when explicitly selected', () => {
    expect(() => copyJson(nested(256), 100_000, true, 256)).not.toThrow();
    expect(() => copyJson(nested(257), 100_000, true, 256)).toThrow('JSON nesting limit');
  });
});
