import { ContextRecordingError } from './types.js';

/** Work/expansion bounds, shared by the reader and its explicit resolutions. */
export function jsonBudget(maxBytes = 64 * 1024 * 1024, maxNodes = 200_000) {
  let bytes = 0;
  let nodes = 0;
  const encoder = new TextEncoder();
  const charge = (value: string): void => {
    if (value.length > maxBytes - bytes) throw new ContextRecordingError('limit');
    bytes += encoder.encode(value).byteLength;
    if (bytes > maxBytes) throw new ContextRecordingError('limit');
  };
  const copy = (value: unknown, depth = 0): unknown => {
    if (++nodes > maxNodes || depth > 100) throw new ContextRecordingError('limit');
    if (value === null || typeof value === 'boolean') {
      charge(String(value));
      return value;
    }
    if (typeof value === 'string') {
      charge(JSON.stringify(value));
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      charge(String(value));
      return value;
    }
    if (value === null || typeof value !== 'object')
      throw new ContextRecordingError('invalid-record');
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== null && proto !== Object.prototype)
      throw new ContextRecordingError('invalid-record');
    const keys = Reflect.ownKeys(value);
    if (keys.length > maxNodes - nodes + 1) throw new ContextRecordingError('limit');
    const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
    charge(Array.isArray(value) ? '[]' : '{}');
    let items = 0;
    for (const key of keys) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string') throw new ContextRecordingError('invalid-record');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
        throw new ContextRecordingError('invalid-record');
      if (Array.isArray(value) && key !== String(items))
        throw new ContextRecordingError('invalid-record');
      charge(`${JSON.stringify(key)}:,`);
      Object.defineProperty(result, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      items++;
    }
    if (Array.isArray(value) && items !== value.length)
      throw new ContextRecordingError('invalid-record');
    return result;
  };
  return { copy };
}
