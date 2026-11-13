import { describe, expect, it } from 'vitest';
import { project } from './project.js';
import type { FirestoreDocumentSnapshotLike } from '../../types.js';

function doc(id: string, row: Record<string, unknown>): FirestoreDocumentSnapshotLike {
  return { id, exists: true, data: () => row };
}

describe('page projection', () => {
  it('lists raw session ids and uses the last included document for its continuation', () => {
    const snapshot = {
      docs: [
        doc('c'.repeat(64), {
          sessionId: 'raw/third',
          savedAt: 3000,
          format: 'conversation-v1',
          messageCount: 3,
        }),
        doc('b'.repeat(64), {
          sessionId: 'raw/second',
          savedAt: 2000,
          format: 'conversation-v1',
          messageCount: 2,
        }),
        doc('a'.repeat(64), { sessionId: 'probe', savedAt: 1000 }),
      ],
    };
    expect(project(snapshot, 2)).toEqual({
      sessions: [
        { sessionId: 'raw/third', savedAt: 3000, format: 'conversation-v1', messageCount: 3 },
        { sessionId: 'raw/second', savedAt: 2000, format: 'conversation-v1', messageCount: 2 },
      ],
      cursor: `2000:${'b'.repeat(64)}`,
    });
  });

  it('a safe display fallback never becomes a fabricated cursor ordering key', () => {
    const snapshot = {
      docs: [
        doc('b'.repeat(64), { sessionId: 4, savedAt: 'not a number' }),
        doc('a'.repeat(64), {}),
      ],
    };
    expect(project(snapshot, 1)).toEqual({
      sessions: [{ sessionId: '', savedAt: 0, format: 'unknown', messageCount: 0 }],
    });
    expect(project({ docs: [] }, 3)).toEqual({ sessions: [] });
  });

  it('a full final page still has no continuation without a probe row', () => {
    expect(
      project({ docs: [doc('a'.repeat(64), { sessionId: 'only', savedAt: 1000 })] }, 1).cursor,
    ).toBeUndefined();
  });

  it('a missing ordering value is not invented from the display fallback', () => {
    const result = project({ docs: [doc('b'.repeat(64), {}), doc('a'.repeat(64), {})] }, 1);
    expect(result.sessions[0]?.savedAt).toBe(0);
    expect(Object.hasOwn(result, 'cursor')).toBe(false);
  });
});
