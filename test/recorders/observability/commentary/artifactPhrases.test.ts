/**
 * The prose vocabulary itself — the layer between a library union and a
 * sentence a non-engineer reads.
 *
 * The compiler already forces every member of `ArtifactOp` /
 * `ArtifactRefusalReason` / `ArtifactSweepReason` to have a phrase (the tables
 * are exhaustive `Record<Union, string>`s). These tests hold the two things a
 * type cannot: that the phrases are WORDS rather than the union member echoed
 * back, and that an unknown value from an older or newer emitter degrades into
 * an honest sentence instead of a blank.
 */

import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_OP_PHRASES,
  ARTIFACT_REFUSAL_PHRASES,
  ARTIFACT_SWEEP_PHRASES,
  humanizeBytes,
  humanizeChars,
  phraseFor,
} from '../../../../src/recorders/observability/commentary/artifactPhrases.js';

describe('humanizeBytes — sizes a person reads', () => {
  it('counts small artifacts in bytes', () => {
    expect(humanizeBytes(0)).toBe('0 bytes');
    expect(humanizeBytes(900)).toBe('900 bytes');
  });

  it('switches to KB and MB at the usual thresholds', () => {
    expect(humanizeBytes(1024)).toBe('1.0 KB');
    expect(humanizeBytes(42_000)).toBe('41.0 KB');
    expect(humanizeBytes(1_048_576)).toBe('1.0 MB');
  });

  it('says it does not know rather than printing NaN', () => {
    expect(humanizeBytes(Number.NaN)).toBe('an unknown size');
    expect(humanizeBytes(-1)).toBe('an unknown size');
  });
});

describe('humanizeChars — the ceiling counts characters, so the prose does too', () => {
  it('groups thousands and pluralizes', () => {
    expect(humanizeChars(1)).toBe('1 character');
    expect(humanizeChars(240_000)).toBe('240,000 characters');
  });

  it('degrades honestly on a value it cannot read', () => {
    expect(humanizeChars(Number.NaN)).toBe('an unknown number of characters');
  });
});

describe('the artifact vocabulary is prose, not union members', () => {
  const allPhrases = [
    ...Object.values(ARTIFACT_OP_PHRASES),
    ...Object.values(ARTIFACT_REFUSAL_PHRASES),
    ...Object.values(ARTIFACT_SWEEP_PHRASES),
  ];

  it('every phrase is a lowercase English fragment with no hyphenated jargon', () => {
    for (const phrase of allPhrases) {
      expect(phrase.length).toBeGreaterThan(8);
      expect(phrase).toMatch(/^[a-z]/);
      expect(phrase).not.toMatch(/[a-z]-[a-z]+-[a-z]/); // 'missing-or-expired' echoed back
    }
  });

  it('covers every door and every refusal reason the store can give', () => {
    expect(Object.keys(ARTIFACT_OP_PHRASES).sort()).toEqual([
      'delete',
      'dispatch',
      'get',
      'head',
      'list',
      'put',
    ]);
    expect(Object.keys(ARTIFACT_REFUSAL_PHRASES).sort()).toEqual([
      'digest-mismatch',
      'invalid-input',
      'kind-mismatch',
      'missing-or-expired',
      'no-store',
      'unknown-parent',
    ]);
    expect(Object.keys(ARTIFACT_SWEEP_PHRASES).sort()).toEqual(['max-bytes', 'max-count', 'ttl']);
  });
});

describe('phraseFor — an unknown vocabulary never renders a hole', () => {
  it('falls back for a value this build has no words for', () => {
    expect(phraseFor(ARTIFACT_SWEEP_PHRASES, 'from-a-later-build', 'no reason recorded')).toBe(
      'no reason recorded',
    );
  });

  it('falls back for a missing value', () => {
    expect(phraseFor(ARTIFACT_OP_PHRASES, undefined, 'an artifact request')).toBe(
      'an artifact request',
    );
  });
});
