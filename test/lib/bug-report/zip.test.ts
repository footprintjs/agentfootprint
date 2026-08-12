/**
 * zipStore — 7-pattern tests.
 *
 *   P1 Unit         — the three record signatures, the counts, the offsets
 *   P2 Boundary     — empty archive, empty file, a name with non-ASCII bytes,
 *                     nested paths, the 1980 date floor
 *   P3 Scenario     — THE REAL PROOF: the system `unzip` opens it, verifies
 *                     every CRC (`unzip -t`) and prints back the exact bytes
 *   P4 Property     — a pure structural parse round-trips every entry, and the
 *                     same input with the same timestamp is byte-identical
 *   P5 Security     — zip-slip names refused: '..', leading '/', a drive
 *                     letter, a backslash; duplicates refused
 *   P6 Performance  — stored output is the sum of its parts plus a bounded
 *                     header cost, and a 4 MB entry does not blow up
 *   P7 ROI          — one dependency-free call replaces a zip library
 *
 * The `unzip` half is what makes this a test of a ZIP FILE rather than a test
 * of my own parser agreeing with my own writer.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { crc32, zipStore } from '../../../src/lib/bug-report/zip.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);
const FIXED = new Date(Date.UTC(2026, 7, 11, 15, 30, 20));

/** Is a real `unzip` on this machine? (Every macOS and Linux CI image has one.) */
function hasUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const unzipAvailable = hasUnzip();

// ─── A pure structural parser, written against APPNOTE, not against the writer ──

interface ParsedEntry {
  readonly name: string;
  readonly text: string;
  readonly crc: number;
  readonly method: number;
  readonly flags: number;
}

/**
 * Read a stored zip the way a reader does: find the end-of-central-directory,
 * walk the central directory, follow each entry's offset to its local header.
 * Deliberately does NOT reuse anything from the writer.
 */
function parseZip(archive: Uint8Array): {
  entries: ParsedEntry[];
  centralCount: number;
  eocdOffset: number;
} {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let eocd = -1;
  for (let at = archive.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  expect(eocd, 'no end-of-central-directory record').toBeGreaterThanOrEqual(0);

  const centralCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  expect(centralOffset + centralSize).toBe(eocd);

  const entries: ParsedEntry[] = [];
  let at = centralOffset;
  for (let i = 0; i < centralCount; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const uncompressed = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(archive.subarray(at + 46, at + 46 + nameLength));
    expect(compressed, 'stored entries have equal sizes').toBe(uncompressed);

    // Follow the offset into the local header and read the data that follows it.
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataAt = localOffset + 30 + localNameLength + localExtraLength;
    const data = archive.subarray(dataAt, dataAt + uncompressed);
    expect(crc32(data), `CRC mismatch for ${name}`).toBe(crc);

    entries.push({ name, text: decoder.decode(data), crc, method, flags });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, centralCount, eocdOffset: eocd };
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('zipStore — P1 unit', () => {
  it('P1 writes local headers, a central directory and an EOCD that agree', () => {
    const archive = zipStore(
      [
        { name: 'manifest.json', data: bytes('{"a":1}') },
        { name: 'notes/narrative.txt', data: bytes('stage ran\n') },
      ],
      { modified: FIXED },
    );
    const parsed = parseZip(archive);
    expect(parsed.centralCount).toBe(2);
    expect(parsed.entries.map((entry) => entry.name)).toEqual([
      'manifest.json',
      'notes/narrative.txt',
    ]);
    expect(parsed.entries[0]!.text).toBe('{"a":1}');
    expect(parsed.entries[1]!.text).toBe('stage ran\n');
  });

  it('P1 every entry is STORED (method 0) and flagged UTF-8 (bit 11)', () => {
    const archive = zipStore([{ name: 'a.json', data: bytes('{}') }], { modified: FIXED });
    for (const entry of parseZip(archive).entries) {
      expect(entry.method).toBe(0);
      expect(entry.flags & 0x0800).toBe(0x0800);
    }
  });

  it('P1 crc32 matches the known IEEE vector for "123456789"', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('zipStore — P2 boundary', () => {
  it('P2 an empty archive is still a valid (readable) zip', () => {
    const archive = zipStore([], { modified: FIXED });
    expect(archive.length).toBe(22); // EOCD only
    expect(parseZip(archive).centralCount).toBe(0);
  });

  it('P2 an empty file round-trips as an empty file', () => {
    const parsed = parseZip(
      zipStore([{ name: 'empty.txt', data: new Uint8Array(0) }], { modified: FIXED }),
    );
    expect(parsed.entries[0]!.text).toBe('');
    expect(parsed.entries[0]!.crc).toBe(0);
  });

  it('P2 non-ASCII names and content survive as UTF-8', () => {
    const parsed = parseZip(
      zipStore([{ name: 'récit/naïve.txt', data: bytes('café — 日本語') }], { modified: FIXED }),
    );
    expect(parsed.entries[0]!.name).toBe('récit/naïve.txt');
    expect(parsed.entries[0]!.text).toBe('café — 日本語');
  });

  it('P2 a pre-1980 timestamp is clamped rather than written as a negative year', () => {
    const archive = zipStore([{ name: 'a.txt', data: bytes('x') }], {
      modified: new Date(Date.UTC(1970, 0, 1)),
    });
    const view = new DataView(archive.buffer);
    expect(view.getUint16(10, true)).toBe(0); // time
    expect(view.getUint16(12, true)).toBe((1 << 5) | 1); // 1980-01-01
  });
});

// ─── P3 Scenario — the system unzip ──────────────────────────────────

describe('zipStore — P3 scenario (real unzip)', () => {
  it.skipIf(!unzipAvailable)('P3 `unzip -t` verifies every CRC in the archive', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-zip-'));
    try {
      const path = join(dir, 'bundle.zip');
      writeFileSync(
        path,
        zipStore(
          [
            { name: 'manifest.json', data: bytes(JSON.stringify({ units: ['conv-1'] })) },
            { name: 'conversations/conv-1.json', data: bytes('{"id":"conv-1"}') },
            { name: 'narrative.txt', data: bytes('seed ran\ncall-llm ran\n') },
          ],
          { modified: FIXED },
        ),
      );
      const output = execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
      expect(output).toContain('No errors detected in compressed data');
      expect(output).toContain('conversations/conv-1.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!unzipAvailable)('P3 `unzip -p` prints back the exact bytes we put in', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-zip-'));
    try {
      const path = join(dir, 'bundle.zip');
      const payload = JSON.stringify({ snapshot: { commitLog: [] }, events: [] });
      writeFileSync(path, zipStore([{ name: 'recording.json', data: bytes(payload) }]));
      expect(execFileSync('unzip', ['-p', path, 'recording.json'], { encoding: 'utf8' })).toBe(
        payload,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!unzipAvailable)('P3 extraction recreates the directory tree on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-zip-'));
    try {
      const path = join(dir, 'bundle.zip');
      writeFileSync(
        path,
        zipStore([{ name: 'conversations/conv-2.json', data: bytes('{"id":"conv-2"}') }]),
      );
      execFileSync('unzip', ['-q', path, '-d', join(dir, 'out')]);
      expect(readFileSync(join(dir, 'out', 'conversations', 'conv-2.json'), 'utf8')).toBe(
        '{"id":"conv-2"}',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('zipStore — P4 property', () => {
  it('P4 every entry round-trips through a parse written against the spec', () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      name: `dir${i % 4}/file-${i}.json`,
      data: bytes(JSON.stringify({ i, padding: 'x'.repeat(i * 7) })),
    }));
    const parsed = parseZip(zipStore(entries, { modified: FIXED }));
    expect(parsed.entries).toHaveLength(entries.length);
    for (const [i, entry] of entries.entries()) {
      expect(parsed.entries[i]!.name).toBe(entry.name);
      expect(parsed.entries[i]!.text).toBe(decoder.decode(entry.data));
    }
  });

  it('P4 same input + same timestamp = byte-identical output', () => {
    const build = (): Uint8Array =>
      zipStore(
        [
          { name: 'a.json', data: bytes('{"a":1}') },
          { name: 'b/c.txt', data: bytes('hello') },
        ],
        { modified: FIXED },
      );
    expect(Array.from(build())).toEqual(Array.from(build()));
  });
});

// ─── P5 Security — zip slip ──────────────────────────────────────────

describe('zipStore — P5 security', () => {
  it.each([
    ['../../etc/passwd', 'a parent-directory escape'],
    ['/etc/passwd', 'an absolute path'],
    ['C:\\Windows\\system32', 'a drive letter'],
    ['dir\\file.json', 'a backslash separator'],
    ['a/../../b.json', 'traversal in the middle'],
  ])('P5 refuses %s (%s)', (name) => {
    expect(() => zipStore([{ name, data: bytes('x') }])).toThrow(/refusing the entry name/);
  });

  it('P5 the refusal teaches the rule rather than just failing', () => {
    expect(() => zipStore([{ name: '../x', data: bytes('x') }])).toThrow(
      /RELATIVE.*escapes the extraction directory/s,
    );
  });

  it('P5 duplicate names are refused, not silently deduplicated', () => {
    expect(() =>
      zipStore([
        { name: 'a.json', data: bytes('1') },
        { name: 'a.json', data: bytes('2') },
      ]),
    ).toThrow(/two entries are both named 'a.json'/);
  });

  it('P5 an empty name is refused', () => {
    expect(() => zipStore([{ name: '', data: bytes('x') }])).toThrow(/empty name/);
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('zipStore — P6 performance', () => {
  it('P6 output is the payload plus a bounded, predictable header cost', () => {
    const payload = new Uint8Array(4 * 1024 * 1024).fill(65);
    const archive = zipStore([{ name: 'big.bin', data: payload }], { modified: FIXED });
    const nameBytes = 'big.bin'.length;
    // 30-byte local header + 46-byte central header + name twice + 22-byte EOCD.
    expect(archive.length).toBe(payload.length + 30 + 46 + nameBytes * 2 + 22);
  });

  it('P6 100 small entries stay linear and parse back', () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
      name: `f${i}.json`,
      data: bytes(`{"i":${i}}`),
    }));
    expect(parseZip(zipStore(entries, { modified: FIXED })).centralCount).toBe(100);
  });
});

// ─── P7 ROI ──────────────────────────────────────────────────────────

describe('zipStore — P7 ROI', () => {
  it('P7 one call, no dependency, and the file opens in an ordinary reader', () => {
    const archive = zipStore([{ name: 'manifest.json', data: bytes('{"manifestVersion":1}') }]);
    // The magic every tool sniffs for.
    expect(Array.from(archive.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(parseZip(archive).entries[0]!.text).toBe('{"manifestVersion":1}');
  });
});
