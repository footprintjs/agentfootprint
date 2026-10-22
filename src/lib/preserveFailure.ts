/** A secondary cleanup failure must not replace an already observed failure.
 * With no primary failure, cleanup remains part of the operation and rejects.
 * Keep this policy shared by SDK iterators and fetch readers. */
export async function closePreservingFailure(
  close: () => unknown,
  alreadyFailed: boolean,
): Promise<void> {
  try {
    await close();
  } catch (error) {
    if (!alreadyFailed) throw error;
  }
}
