import { expect } from 'vitest';

/**
 * Expected side only: a saved record taken before the library marked a
 * person's typed answer, with that one addition made. Every recorded
 * `role: 'tool'` message whose content is an `input_received` result gains
 * `answersAsk: { requestId }` (the request id as the record spells it, a
 * placeholder included), as `resume/plain.ts` · `resumePlain` now lands it.
 * Provider requests are left as recorded: `stripFrameworkFields` removes the
 * mark before a request exists, so the saved requests must still match byte
 * for byte. Everything else in the reference stays exact.
 *
 * @example
 * ```ts
 * expect(record).toEqual(withTypedAnswerMark(legacy));
 * ```
 */
export function withTypedAnswerMark<T>(legacy: T): T {
  let marked = 0;
  const walk = (value: unknown, key?: string): unknown => {
    if (key === 'requests') return value;
    if (Array.isArray(value)) return value.map((item) => walk(item));
    if (typeof value !== 'object' || value === null) return value;
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => [k, walk(v, k)] as const,
    );
    const copy = Object.fromEntries(entries) as Record<string, unknown>;
    if (copy.role === 'tool' && typeof copy.content === 'string') {
      expect(copy).not.toHaveProperty('answersAsk');
      const requestId = landedRequestOf(copy.content);
      if (requestId !== undefined) {
        marked += 1;
        return { ...copy, answersAsk: { requestId } };
      }
    }
    return copy;
  };
  const result = walk(legacy) as T;
  expect(marked, 'the saved record holds no landed typed answer').toBeGreaterThan(0);
  return result;
}

function landedRequestOf(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as { status?: unknown; requestId?: unknown };
    return parsed.status === 'input_received' && typeof parsed.requestId === 'string'
      ? parsed.requestId
      : undefined;
  } catch {
    return undefined;
  }
}
