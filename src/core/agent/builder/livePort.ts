/** Stateless capabilities over the facade's existing fields and methods. */
type LiveAccessors<T extends object> = {
  [Key in keyof T]: {
    get: () => T[Key];
    set?: (value: T[Key]) => void;
  };
};

/** Define accessors without reading the values they expose. */
export function livePort<T extends object>(accessors: LiveAccessors<T>): T {
  return Object.defineProperties({}, accessors) as T;
}
