/**
 * strictJson — the transport's ONE reading of an answer.
 *
 *   P1 Unit      — every ambiguity refused by name
 *   P4 Property  — on unambiguous JSON (500 generated values) it reads exactly
 *                  what `JSON.parse` reads,
 *                  so the canonical form the client gets is the same value
 */

import { describe, expect, it } from 'vitest';

import {
  AmbiguousJsonError,
  MAX_DEPTH,
  parseStrictJson,
} from '../../src/adapters/mcp/agentcoreRuntime/strictJson.js';

describe('strictJson — P1 every ambiguity refused by name', () => {
  it.each([
    ['{"a":1,"a":2}', /duplicated object key/],
    ['{"x":{"a":1,"a":2}}', /duplicated object key/],
    ['{"a":1} {"b":2}', /trailing data/],
    ['{"a":1}x', /trailing data/],
    ['﻿{"a":1}', /byte-order mark/],
    ['"a\u0001b"', /control character/],
    ['"\\x41"', /unknown escape/],
    ['"\\u12G4"', /malformed \\u escape/],
    ['"abc', /unterminated string/],
    ['{a:1}', /not a string/],
    ['01', /trailing data/],
    ['NaN', /not JSON/],
    ['', /not JSON/],
    ['[1,]', /not JSON/],
    ['1e400', /number out of range/],
  ])('%j is refused', (text, reason) => {
    expect(() => parseStrictJson(text)).toThrow(AmbiguousJsonError);
    expect(() => parseStrictJson(text)).toThrow(reason);
  });

  it('nesting past the ceiling is refused, not a stack overflow', () => {
    const deep = '['.repeat(MAX_DEPTH + 2) + ']'.repeat(MAX_DEPTH + 2);
    expect(() => parseStrictJson(deep)).toThrow(/nesting too deep/);
  });

  it('a duplicated-key refusal never names the key — it is the answer’s text', () => {
    expect(() => parseStrictJson('{"SECRET-KEY-1":1,"SECRET-KEY-1":2}')).toThrow(
      /^ambiguous JSON: a duplicated object key$/,
    );
  });

  it('`__proto__` is an own data property, never a prototype', () => {
    const value = parseStrictJson('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(['__proto__']);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('strictJson — P4 the same value JSON.parse reads', () => {
  it('for 500 generated JSON values: the one reading equals JSON.parse, and re-serializes the same', () => {
    let seed = 0x5eed;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const chars = 'aZ09 _-"\\/\n\t\u0001\u00e9\u4e2d\ud83d\ude00\ud800';
    const str = (): string =>
      Array.from(
        { length: Math.floor(next() * 12) },
        () => chars[Math.floor(next() * chars.length)],
      ).join('');
    const value = (depth: number): unknown => {
      const pick = Math.floor(next() * (depth > 4 ? 5 : 7));
      if (pick === 0) return null;
      if (pick === 1) return next() < 0.5;
      if (pick === 2) return Math.floor((next() - 0.5) * 1e6) / (next() < 0.5 ? 1 : 1000);
      if (pick === 3) return str();
      if (pick === 4) return next() * 1e21 * (next() < 0.5 ? -1 : 1);
      if (pick === 5) return Array.from({ length: Math.floor(next() * 4) }, () => value(depth + 1));
      const out: Record<string, unknown> = {};
      for (let i = 0; i < Math.floor(next() * 4); i++) out[`${str()}${i}`] = value(depth + 1);
      return out;
    };
    for (let run = 0; run < 500; run++) {
      const text = JSON.stringify(value(0));
      const read = parseStrictJson(text);
      expect(read).toEqual(JSON.parse(text));
      expect(JSON.stringify(read)).toBe(JSON.stringify(JSON.parse(text)));
    }
  });

  it('whitespace and escapes read as JSON.parse reads them', () => {
    const text = ' {\n\t"a" : [ 1 , -2.5e3 , "\\u00e9\\n\\"" , true , null ] }\r\n';
    expect(parseStrictJson(text)).toEqual(JSON.parse(text));
  });
});
