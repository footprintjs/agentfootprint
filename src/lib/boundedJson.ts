/** Strict, bounded JSON data helpers shared by internal validation boundaries. */
const encoder = new TextEncoder();

export function ownData(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Expected a plain data object.');
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || (allowed && !allowed.includes(key)))
      throw new Error('Unknown property.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor))
      throw new Error('Expected an enumerable data property.');
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

/** JSON copy without invoking toJSON/getters or silently dropping data. */
export function copyJson(value: unknown, maxBytes: number, freeze: boolean): unknown {
  let budget = maxBytes;
  const ancestors = new Set<object>();
  const spend = (bytes: number) => {
    budget -= bytes;
    if (budget < 0) throw new Error('JSON byte limit.');
  };
  const string = (item: string) => {
    if (item.length > budget) throw new Error('JSON byte limit.');
    spend(encoder.encode(JSON.stringify(item)).byteLength);
  };
  const copy = (item: unknown, depth: number): unknown => {
    if (depth > 100) throw new Error('JSON nesting limit.');
    if (item === null) {
      spend(4);
      return null;
    }
    if (typeof item === 'string') {
      string(item);
      return item;
    }
    if (typeof item === 'boolean') {
      spend(item ? 4 : 5);
      return item;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0))
        throw new Error('Non-lossless JSON number.');
      spend(JSON.stringify(item).length);
      return item;
    }
    if (typeof item !== 'object') throw new Error('Non-JSON value.');
    if (ancestors.has(item)) throw new Error('Cyclic JSON value.');
    ancestors.add(item);
    spend(2);
    let output: unknown;
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype)
        throw new Error('Non-JSON array prototype.');
      if (item.length > budget + 1) throw new Error('JSON byte limit.');
      const keys = Reflect.ownKeys(item);
      if (keys.length !== item.length + 1) throw new Error('Sparse or decorated array.');
      const result: unknown[] = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor))
          throw new Error('Sparse or accessor array.');
        if (index) spend(1);
        result.push(copy(descriptor.value, depth + 1));
      }
      output = result;
    } else {
      const fields = ownData(item);
      const result: Record<string, unknown> = {};
      let index = 0;
      for (const key of Object.keys(fields)) {
        if (index++) spend(1);
        string(key);
        spend(1);
        Object.defineProperty(result, key, {
          value: copy(fields[key], depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      output = result;
    }
    ancestors.delete(item);
    return freeze ? Object.freeze(output) : output;
  };
  return copy(value, 0);
}
