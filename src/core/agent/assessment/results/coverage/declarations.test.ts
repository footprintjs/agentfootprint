import { describe, expect, it } from 'vitest';
import { absent } from '../../../../../semantics/coverage/absent.js';
import { coverage } from '../../../../../semantics/coverage/ledger.js';
import { REASONS } from '../../reasons.js';
import { isDeclarationWitness } from '../../reasonClasses.js';
import {
  declaredResultAdmitted,
  declarationsForResult,
  hasOwnDeclarationWitness,
} from './declarations.js';

const key = [1, 2, 3, 4, 0] as const;
const row = { kind: 'absence', callOccurrenceKey: key };
const nativeRows = [{ index: 0, kind: 'absence' as const, historyIndex: 2, gap: true }];

describe('declaration evidence has its own admission and delivered-value door', () => {
  it.each(['ledger', 'absence', 'period'])(
    'admits a recorded %s under positive returned occurrence proof',
    (kind) => {
      const proof = {
        native: () => false,
        returned: (_address: number | undefined, found: string | null | undefined) =>
          found === key.join('.'),
      };
      expect(declaredResultAdmitted({ ...row, kind }, undefined, proof)).toBe(true);
      expect(declaredResultAdmitted({ kind }, undefined, proof)).toBe(false);
      expect(declaredResultAdmitted({ kind, callOccurrenceKey: [1] }, undefined, proof)).toBe(
        false,
      );
      expect(
        declaredResultAdmitted({ kind, callOccurrenceKey: [5, 6, 7, 8, 0] }, undefined, proof),
      ).toBe(false);
    },
  );

  it('keeps an existing native-period attestation without guessing a returned result', () => {
    expect(
      declaredResultAdmitted({ kind: 'period' }, undefined, {
        native: () => true,
        returned: () => false,
      }),
    ).toBe(true);
    expect(
      declaredResultAdmitted(row, undefined, {
        native: () => false,
        returned: () => false,
      }),
    ).toBe(false);
  });

  it('does not turn shape or validation findings into declarations', () => {
    for (const kind of ['integrity-finding', 'argument', 'contingent', undefined]) {
      expect(
        declaredResultAdmitted({ ...row, kind }, 2, {
          native: () => false,
          returned: () => true,
        }),
      ).toBe(false);
    }
    for (const { reason } of REASONS) {
      expect(isDeclarationWitness('answerValidation', 'ledger', reason)).toBe(false);
      expect(isDeclarationWitness('findingsLedger', 'integrity-finding', reason)).toBe(false);
    }
  });

  it.each([
    {
      value: coverage(['replacement'], { checked: ['public'], notChecked: ['other'] }),
      gap: true,
      absent: false,
    },
    { value: absent({ what: 'replacement', checked: ['public'] }), gap: false, absent: true },
  ])(
    'keeps native check coverage while reading the replacement independently ($gap, $absent)',
    ({ value, gap, absent: isAbsent }) => {
      const projection = declarationsForResult(
        { index: 2, content: JSON.stringify(value), rewritten: true },
        nativeRows,
      );
      expect(projection.rows).toEqual([]);
      expect(projection.declared).toBe(true);
      expect(projection.own?.gap === true).toBe(gap);
      expect(projection.own?.absent === true).toBe(isAbsent);
      expect(nativeRows).toEqual([{ index: 0, kind: 'absence', historyIndex: 2, gap: true }]);
    },
  );

  it('retains the exact native projection and avoids inventing a declaration for plain text', () => {
    expect(declarationsForResult({ index: 2, content: 'summary' }, nativeRows)).toEqual({
      rows: nativeRows,
      declared: true,
    });
    expect(declarationsForResult({ index: 2, content: 'summary', rewritten: true }, [])).toEqual({
      rows: [],
      declared: false,
    });
  });

  it('a replacement is another declaration witness, while a native settlement repeats its row', () => {
    expect(hasOwnDeclarationWitness('rewritten', true)).toBe(true);
    expect(hasOwnDeclarationWitness('native', true)).toBe(false);
    expect(hasOwnDeclarationWitness('native', false)).toBe(true);
  });
});
