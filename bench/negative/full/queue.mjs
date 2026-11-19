/** A fixed-width queue that drains in-flight work before releasing the run lock. */
export async function runQueue(rows, width, visit) {
  if (!Number.isInteger(width) || width < 1 || width > 3)
    throw new Error('Concurrency must be 1–3.');
  let next = 0,
    failed = false,
    failure;
  await Promise.all(
    Array.from({ length: Math.min(width, rows.length) }, async () => {
      while (!failed && next < rows.length) {
        const row = rows[next++];
        try {
          await visit(row);
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    }),
  );
  if (failed) throw failure;
}
