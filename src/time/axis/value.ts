export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function describeValue(value: unknown): string {
  if (value === undefined) return 'nothing';
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return typeof value;
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
  } catch {
    return typeof value;
  }
}
