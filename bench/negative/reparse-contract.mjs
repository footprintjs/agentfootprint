/** The original full-path benchmark app parser, copied without loosening its
 * contract. It remains separate from the library's JSON-envelope decoder.
 * Source: registered harness.mjs at da9e658f (parseAnswer). No model or I/O. */
export function parseBenchmarkAnswer(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.summary !== 'string' ||
    !Array.isArray(value.negatives)
  )
    throw new Error('benchmark answer requires summary and negatives');
  if (Object.keys(value).some((key) => !['summary', 'negatives'].includes(key)))
    throw new Error('benchmark answer contains an extra field');
  for (const entry of value.negatives) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      !['none', 'not-found', 'complete'].includes(entry.kind) ||
      !['string', 'number'].includes(typeof entry.about) ||
      !Array.isArray(entry.restsOn) ||
      entry.restsOn.length === 0 ||
      entry.restsOn.some(
        (handle) => typeof handle !== 'string' || !/^r[1-9][0-9]{0,3}$/.test(handle),
      ) ||
      Object.keys(entry).some((key) => !['kind', 'about', 'restsOn'].includes(key))
    )
      throw new Error('benchmark answer contains an invalid citation');
  }
  return value;
}

/** Diagnostics only, after the unchanged parser has refused the candidate.
 * Closed reason codes contain no candidate text and never repair the shape. */
export function benchmarkSchemaIssues(value) {
  const issues = new Set();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ['invalid-root'];
  if (typeof value.summary !== 'string') issues.add('invalid-summary');
  if (Object.keys(value).some((key) => !['summary', 'negatives'].includes(key)))
    issues.add('extra-root-fields');
  if (!Array.isArray(value.negatives)) issues.add('invalid-negatives');
  else
    for (const entry of value.negatives) {
      if (entry === null || typeof entry !== 'object') {
        issues.add('invalid-citation');
        continue;
      }
      if (!['none', 'not-found', 'complete'].includes(entry.kind)) issues.add('invalid-kind');
      if (!['string', 'number'].includes(typeof entry.about)) issues.add('invalid-about');
      if (!Array.isArray(entry.restsOn)) issues.add('invalid-references');
      else {
        if (entry.restsOn.length === 0) issues.add('empty-references');
        if (entry.restsOn.some((ref) => typeof ref !== 'string' || !/^r[1-9][0-9]{0,3}$/.test(ref)))
          issues.add('malformed-handle');
      }
      if (Object.keys(entry).some((key) => !['kind', 'about', 'restsOn'].includes(key)))
        issues.add('extra-citation-fields');
    }
  return [...issues];
}
