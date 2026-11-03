/**
 * The first `n` UTF-16 units of `s`, one fewer when the cut would split a
 * surrogate pair — a lone high surrogate is not valid Unicode, and a strict
 * OTLP/JSON decoder rejects it.
 */
export function cutAt(s: string, n: number): string {
  const code = s.charCodeAt(n - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n);
}
