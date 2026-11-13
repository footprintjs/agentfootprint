/** Close every content-capture subscription; preserve the primary failure. */
export function releaseCaptures(
  offs: readonly (() => void)[],
  primary?: { readonly error: unknown },
): void {
  let failure = primary;
  for (const off of offs) {
    try {
      off();
    } catch (error) {
      failure ??= { error };
    }
  }
  if (failure) throw failure.error;
}
