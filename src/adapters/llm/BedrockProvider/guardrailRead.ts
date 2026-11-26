/** Bounded own-data inspection. SDK allocation and Proxy execution precede these limits. */
export interface OwnField {
  readonly present: boolean;
  readonly valid: boolean;
  readonly value?: unknown;
}

/** Accessor bodies are never called. Reflection can still execute a Proxy trap. */
export function ownData(value: unknown, key: PropertyKey): OwnField {
  if (typeof value !== 'object' || value === null) return { present: false, valid: false };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return { present: false, valid: true };
    return 'value' in descriptor
      ? { present: true, valid: true, value: descriptor.value }
      : { present: true, valid: false };
  } catch {
    return { present: false, valid: false };
  }
}

/** A read budget is a bound on admitted inspection, not total CPU, memory or trap duration. */
export class GuardrailInspection {
  private remaining = 4096;
  complete = true;

  private spend(): boolean {
    if (this.remaining === 0) {
      this.complete = false;
      return false;
    }
    this.remaining--;
    return true;
  }

  field(value: unknown, key: PropertyKey): OwnField {
    if (!this.spend()) return { present: false, valid: false };
    const result = ownData(value, key);
    if (!result.valid) this.complete = false;
    return result;
  }

  /** Native enumeration can materialize a whole foreign map before this length test. */
  keys(value: unknown, array = false): readonly string[] | undefined {
    if (!this.spend()) return undefined;
    try {
      if (typeof value !== 'object' || value === null || Array.isArray(value) !== array) {
        this.complete = false;
        return undefined;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)) {
        this.complete = false;
        return undefined;
      }
      const keys = Reflect.ownKeys(value);
      // The size guard includes symbols before any entry walk. Unknown keys
      // make the shape incomplete, but must not conceal a supported sibling.
      if (keys.length > this.remaining) {
        this.complete = false;
        return undefined;
      }
      this.remaining -= keys.length;
      if (keys.some((key) => typeof key !== 'string')) this.complete = false;
      return keys.filter((key): key is string => typeof key === 'string');
    } catch {
      this.complete = false;
      return undefined;
    }
  }

  /** Foreign arrays are visited by own indices, never by a custom iterator. Holes stay unknown. */
  list(value: unknown, visit: (entry: unknown) => void): void {
    const keys = this.keys(value, true);
    if (keys === undefined) return;
    const length = this.field(value, 'length').value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
      this.complete = false;
      return;
    }
    // A hole or extra property prevents masking-only proof, but does not
    // hide a later independently valid BLOCKED carrier within this budget.
    if (
      keys.length !== length + 1 ||
      keys.some((key) => key !== 'length' && !/^(?:0|[1-9][0-9]*)$/.test(key))
    )
      this.complete = false;
    for (let index = 0; index < length; index++) {
      if (this.remaining === 0) {
        this.complete = false;
        break;
      }
      const entry = this.field(value, String(index));
      if (entry.valid && entry.present) visit(entry.value);
      else this.complete = false;
    }
  }
}
