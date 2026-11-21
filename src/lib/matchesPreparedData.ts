/** Compare a prepared value with the editable data handed across a port. */
export function matchesPreparedData(expected: unknown, current: unknown): boolean {
  try {
    return sameData(expected, current, new Map(), new Set());
  } catch {
    return false;
  }
}

function sameData(
  expected: unknown,
  current: unknown,
  pairs: Map<object, object>,
  matched: Set<object>,
): boolean {
  if (Object.is(expected, current)) return true;
  if (
    expected === null ||
    current === null ||
    typeof expected !== 'object' ||
    typeof current !== 'object' ||
    Object.getPrototypeOf(expected) !== Object.getPrototypeOf(current)
  )
    return false;
  if (pairs.has(expected)) return pairs.get(expected) === current;
  if (matched.has(current)) return false;
  pairs.set(expected, current);
  matched.add(current);
  const compare = (left: unknown, right: unknown) => sameData(left, right, pairs, matched);

  if (expected instanceof Date && current instanceof Date)
    return Object.is(expected.getTime(), current.getTime());
  if (expected instanceof RegExp && current instanceof RegExp)
    return (
      expected.source === current.source &&
      expected.flags === current.flags &&
      expected.lastIndex === current.lastIndex
    );
  if (expected instanceof Map && current instanceof Map) {
    const right = [...current];
    return (
      expected.size === current.size &&
      [...expected].every(
        ([key, value], index) =>
          compare(key, right[index]?.[0]) && compare(value, right[index]?.[1]),
      )
    );
  }
  if (expected instanceof Set && current instanceof Set) {
    const right = [...current];
    return (
      expected.size === current.size &&
      [...expected].every((value, index) => compare(value, right[index]))
    );
  }
  if (ArrayBuffer.isView(expected) && ArrayBuffer.isView(current))
    return (
      expected.byteOffset === current.byteOffset &&
      expected.byteLength === current.byteLength &&
      compare(expected.buffer, current.buffer)
    );
  if (expected instanceof ArrayBuffer && current instanceof ArrayBuffer) {
    const right = new Uint8Array(current);
    return (
      expected.byteLength === current.byteLength &&
      new Uint8Array(expected).every((byte, index) => byte === right[index])
    );
  }
  if (Array.isArray(expected) && Array.isArray(current)) {
    if (expected.length !== current.length) return false;
  } else if (Object.getPrototypeOf(expected) !== Object.prototype) return false;
  const leftKeys = Reflect.ownKeys(expected);
  const rightKeys = Reflect.ownKeys(current);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => {
      if (key !== rightKeys[index]) return false;
      const left = Object.getOwnPropertyDescriptor(expected, key);
      const right = Object.getOwnPropertyDescriptor(current, key);
      return (
        left !== undefined &&
        right !== undefined &&
        'value' in left &&
        'value' in right &&
        left.enumerable === right.enumerable &&
        compare(left.value, right.value)
      );
    })
  );
}
