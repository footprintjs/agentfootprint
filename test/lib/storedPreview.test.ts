/**
 * lib/storedPreview — how much of somebody's stored data an error may quote.
 *
 * This is a redaction rule, so the tests are written the way redaction tests
 * have to be: every one of them asserts what does NOT appear. Error messages
 * travel further than any other string a library produces — logs, dashboards,
 * bug reports pasted into chat windows — and the whole reason this module exists
 * is that two adapters describing unreadable bytes must not each invent their
 * own idea of "a bit of it".
 *
 * Two functions, because a cap is only safe when the first bytes are structure:
 *   • previewStored      — quotes a capped prefix. For values that OPEN with
 *                          metadata (a CheckpointEnvelope: format, data, savedAt).
 *   • describeStoredShape — quotes nothing at all. For values whose content
 *                          starts immediately (a MemoryEntry: id, then value).
 */

import { describe, expect, it } from 'vitest';

import {
  describeStoredShape,
  previewStored,
  STORED_PREVIEW_LIMIT,
} from '../../src/lib/storedPreview.js';

const SECRET = 'her card number is 4111 1111 1111 1111';

describe('previewStored — a capped quote', () => {
  it('quotes a short string whole', () => {
    expect(previewStored('nope')).toBe('"nope"');
  });

  it('caps a long one and says how much it withheld', () => {
    const long = `{format=conversation-v1, data={version=1, runId=run-7, history=[${SECRET}]}}`;
    const preview = previewStored(long);
    expect(preview).toContain('format=conversation-v1');
    expect(preview).not.toContain(SECRET);
    expect(preview).toContain(`(${long.length} chars)`);
    // The quote itself never exceeds the cap, whatever the input.
    expect(preview.length).toBeLessThan(STORED_PREVIEW_LIMIT + 30);
  });

  it.each([
    [0, ''],
    [1, 'x'],
    [STORED_PREVIEW_LIMIT, 'y'.repeat(STORED_PREVIEW_LIMIT)],
    [STORED_PREVIEW_LIMIT + 1, 'z'.repeat(STORED_PREVIEW_LIMIT + 1)],
    [5000, 'w'.repeat(5000)],
  ])('never quotes more than the cap (input length %i)', (_length, input) => {
    const quoted = previewStored(input).match(/"([\s\S]*?)…?"/)?.[1] ?? '';
    expect(quoted.length).toBeLessThanOrEqual(STORED_PREVIEW_LIMIT);
  });

  it('summarises structured values instead of serializing them', () => {
    // The failure this prevents: String(obj) / JSON.stringify(arr) printing the
    // very payload the module exists to keep out of the message.
    expect(previewStored({ id: 'm-1', value: SECRET })).toBe('an object with keys: id, value');
    expect(previewStored([{ blob: SECRET }])).toBe('an array of 1 item(s)');
    expect(previewStored({ id: 'm-1', value: SECRET })).not.toContain(SECRET);
    expect(previewStored([{ blob: SECRET }])).not.toContain(SECRET);
  });

  it('lists at most eight keys, so a wide object cannot become a dump', () => {
    const wide = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, SECRET]));
    const preview = previewStored(wide);
    expect(preview).not.toContain(SECRET);
    expect(preview.split(', ')).toHaveLength(8);
  });

  it('handles the boring rest without inventing anything', () => {
    expect(previewStored(null)).toBe('null');
    expect(previewStored(undefined)).toBe('undefined');
    expect(previewStored(7)).toBe('number 7');
    expect(previewStored(true)).toBe('boolean true');
    expect(previewStored({})).toBe('an object with no keys');
  });
});

describe('describeStoredShape — a quote of nothing', () => {
  it('describes a mangled entry without printing any of it', () => {
    const mangled = `{id=a, value={text=${SECRET}}, version=1}`;
    const shape = describeStoredShape(mangled);
    expect(shape).toBe(`a ${mangled.length}-character string that is not JSON, starting "{"`);
    // The point of the whole function.
    expect(shape).not.toContain(SECRET);
    expect(shape).not.toContain('id=a');
    expect(shape).not.toContain('4111');
  });

  it('still diagnoses: length, JSON-ness, and how it opens', () => {
    // Enough to tell "something stringified an object" from "somebody stored a
    // JSON array" from "this is not our data at all", which is every question
    // the refusal has to support.
    expect(describeStoredShape('{"id":"a"}')).toBe(
      'a 10-character string that parses as JSON, starting "{"',
    );
    expect(describeStoredShape('"just a string"')).toBe(
      'a 15-character string that parses as JSON but is a bare string, starting "\\""',
    );
    expect(describeStoredShape('null')).toBe(
      'a 4-character string that parses as JSON but is a bare null, starting "n"',
    );
    expect(describeStoredShape('')).toBe('a 0-character string that is not JSON');
  });

  it('never quotes more than one structural character, at any length', () => {
    const long = SECRET.repeat(50);
    const shape = describeStoredShape(long);
    expect(shape).not.toContain('card number');
    expect(shape).toContain(`${long.length}-character`);
  });

  it('summarises non-strings exactly as the capped variant does', () => {
    expect(describeStoredShape({ id: 'm-1', value: SECRET })).toBe(
      'an object with keys: id, value',
    );
    expect(describeStoredShape([1, 2, 3])).toBe('an array of 3 item(s)');
    expect(describeStoredShape(null)).toBe('null');
    expect(describeStoredShape(42)).toBe('number 42');
  });
});
