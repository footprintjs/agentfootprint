/**
 * Validate JavaScript option bags against the current declaration, before a
 * factory does any work. The factory owns its vocabulary; this helper owns
 * rejection. Unknown frontmatter is deliberately a different contract.
 *
 * Inspect property names, not values: an unknown getter must not run just to
 * explain a typo. Include inherited declarations so an option cannot escape
 * validation by moving onto a custom prototype.
 */
export function assertKnownOptions(
  where: string,
  options: object,
  allowed: Readonly<Record<string, true>>,
): void {
  for (let owner: object | null = options; owner !== null && owner !== Object.prototype; ) {
    for (const key of Reflect.ownKeys(owner)) {
      // A class instance is a valid structural options bag. Its prototype's
      // own constructor describes the class, not an option supplied by it.
      // Do not skip an own option with that name or invoke a getter.
      if (owner !== options && key === 'constructor') {
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        if (typeof descriptor?.value === 'function' && descriptor.value.prototype === owner) {
          continue;
        }
      }
      if (typeof key !== 'string' || !Object.hasOwn(allowed, key)) {
        throw new Error(`${where}: unsupported option ${String(key)}.`);
      }
    }
    owner = Object.getPrototypeOf(owner);
  }
}
