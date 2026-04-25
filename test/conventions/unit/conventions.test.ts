/**
 * Unit tests — conventions.ts (subflow ID protocol).
 */

import { describe, it, expect } from 'vitest';
import {
  SUBFLOW_IDS,
  STAGE_IDS,
  isSlotSubflow,
  slotFromSubflowId,
  isKnownSubflow,
  isKnownStage,
} from '../../../src/conventions.js';

describe('SUBFLOW_IDS — single source of truth', () => {
  it('has exactly the 7 known subflow IDs', () => {
    const expected = [
      'sf-system-prompt',
      'sf-messages',
      'sf-tools',
      'sf-route',
      'sf-tool-calls',
      'sf-merge',
      'sf-final',
    ];
    const actual = Object.values(SUBFLOW_IDS).sort();
    expect(actual).toEqual(expected.sort());
  });

  it('all IDs start with sf- prefix', () => {
    for (const id of Object.values(SUBFLOW_IDS)) {
      expect(id.startsWith('sf-')).toBe(true);
    }
  });
});

describe('STAGE_IDS — single source of truth', () => {
  it('has the 6 known stage IDs', () => {
    const actual = Object.values(STAGE_IDS).sort();
    expect(actual).toEqual(
      ['seed', 'call-llm', 'final', 'format-merge', 'merge-llm', 'extract-merge'].sort(),
    );
  });
});

describe('type guards — isSlotSubflow', () => {
  it('accepts the 3 slot subflow IDs', () => {
    expect(isSlotSubflow(SUBFLOW_IDS.SYSTEM_PROMPT)).toBe(true);
    expect(isSlotSubflow(SUBFLOW_IDS.MESSAGES)).toBe(true);
    expect(isSlotSubflow(SUBFLOW_IDS.TOOLS)).toBe(true);
  });

  it('rejects non-slot subflow IDs', () => {
    expect(isSlotSubflow(SUBFLOW_IDS.ROUTE)).toBe(false);
    expect(isSlotSubflow(SUBFLOW_IDS.TOOL_CALLS)).toBe(false);
    expect(isSlotSubflow(SUBFLOW_IDS.MERGE)).toBe(false);
    expect(isSlotSubflow(SUBFLOW_IDS.FINAL)).toBe(false);
    expect(isSlotSubflow('sf-unknown')).toBe(false);
    expect(isSlotSubflow('')).toBe(false);
  });
});

describe('slotFromSubflowId', () => {
  it('maps each slot subflow ID to its ContextSlot name', () => {
    expect(slotFromSubflowId(SUBFLOW_IDS.SYSTEM_PROMPT)).toBe('system-prompt');
    expect(slotFromSubflowId(SUBFLOW_IDS.MESSAGES)).toBe('messages');
    expect(slotFromSubflowId(SUBFLOW_IDS.TOOLS)).toBe('tools');
  });

  it('returns undefined for non-slot subflow IDs', () => {
    expect(slotFromSubflowId(SUBFLOW_IDS.ROUTE)).toBeUndefined();
    expect(slotFromSubflowId('anything-else')).toBeUndefined();
  });
});

describe('isKnownSubflow / isKnownStage', () => {
  it('recognizes every constant in SUBFLOW_IDS', () => {
    for (const id of Object.values(SUBFLOW_IDS)) {
      expect(isKnownSubflow(id)).toBe(true);
    }
    expect(isKnownSubflow('sf-unknown')).toBe(false);
  });

  it('recognizes every constant in STAGE_IDS', () => {
    for (const id of Object.values(STAGE_IDS)) {
      expect(isKnownStage(id)).toBe(true);
    }
    expect(isKnownStage('unknown-stage')).toBe(false);
  });
});
