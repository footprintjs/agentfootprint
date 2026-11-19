const answerMarkers = /(?<marker>\[+[^\r\n\[\]]*\]+|\[+[^\s\[\]]*|(?<![\p{L}\p{N}_\]])[rR]\d+\]+|\]+)|\r\n?|\n|[.!?]+(?=[\s\[]|$)/gu;
const labelPrefix = /^[ \t]*(?:[,;][ \t]*)?(?:[-*+][ \t]+)?$/u;
const handleMarker = /^\[(r[1-9]\d*)\]$/u;

function labelReader(fields) {
  const names = fields.map(({ name }) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{N}_*])(?:\\*\\*)?(${names.join('|')})(?:\\*\\*)?[ \\t]*:(?:\\*\\*)?`, 'giu');
}

function claimsIn(span, labels, canonicalTokens) {
  const starts = [...span.matchAll(labels)];
  if (starts.length === 0 || !labelPrefix.test(span.slice(0, starts[0].index))) return [];
  return starts.flatMap(([label, name], index) => {
    const start = starts[index].index + label.length;
    const end = starts[index + 1]?.index ?? span.length;
    const value = span.slice(start, end).trim().replace(/[,;]+$/u, '').trimEnd();
    const tokens = canonicalTokens(value);
    return tokens.length === 0 ? [] : [{ name: name.toLowerCase(), value, tokens }];
  });
}

function resolveMarker(marker, bindings, visible) {
  const handle = handleMarker.exec(marker)?.[1];
  if (handle === undefined) return { citation: 'bad-handle' };
  const matches = bindings.filter((binding) => binding.handle === handle);
  if (matches.length !== 1) return { citation: 'bad-handle' };

  const [{ toolCallId, source }] = matches;
  const slots = visible.filter((slot) => slot.handle === handle && slot.toolCallId === toolCallId &&
    slot.source === source && Number.isInteger(slot.messageIndex) && slot.messageIndex >= 0);
  if (slots.length === 0) return { citation: 'out-of-window' };
  if (slots.length !== 1) return { citation: 'bad-handle' };
  return { source, content: slots[0].content };
}

/** Score the final answer's labeled values against the observed slots of its request. */
export function scoreAnswer({ task, answer, bindings, visible }, { canonicalTokens, occursIn }) {
  const text = typeof answer === 'string' ? answer : '';
  const labels = labelReader(task.fields);
  const names = new Map(task.fields.map(({ name }) => [name.toLowerCase(), name]));
  const fieldClaims = new Map(task.fields.map(({ name }) => [name.toLowerCase(), []]));
  const markers = [];

  function recordSpan(span, marker) {
    const claims = claimsIn(span, labels, canonicalTokens);
    if (marker !== undefined && claims.length === 0) {
      markers.push({ marker, citation: 'orphan-marker' });
      return;
    }

    const resolved = marker === undefined ? {} : resolveMarker(marker, bindings, visible);
    const resultTokens = resolved.content === undefined ? undefined : canonicalTokens(resolved.content);
    for (const claim of claims) {
      let pair;
      if (marker !== undefined) {
        const citation = resolved.citation ?? (occursIn(claim.tokens, resultTokens) ? 'valid' : 'wrong-value');
        pair = { name: names.get(claim.name), value: claim.value, marker, citation };
        markers.push(pair);
      }
      fieldClaims.get(claim.name).push({ ...claim, pair, citedSource: resolved.source });
    }
  }

  // A marker closes the preceding span. A new line or sentence closes it without a marker.
  let from = 0;
  for (const boundary of text.matchAll(answerMarkers)) {
    recordSpan(text.slice(from, boundary.index), boundary.groups.marker);
    from = boundary.index + boundary[0].length;
  }
  recordSpan(text.slice(from));

  let instructedSourceCited = false;
  const fields = task.fields.map(({ name, value, source }) => {
    const claims = fieldClaims.get(name.toLowerCase());
    if (claims.length === 0) return { name, state: 'missing' };
    if (claims.length > 1) {
      // Keep the observed membership outcomes for diagnosis and flag the pairs as duplicates.
      for (const { pair } of claims) if (pair !== undefined) pair.duplicate = true;
      return { name, state: 'wrong', duplicate: true };
    }

    const [claim] = claims;
    const expected = canonicalTokens(String(value));
    const correct = expected.length === claim.tokens.length && occursIn(expected, claim.tokens);
    if (claim.citedSource !== undefined && claim.citedSource === source) instructedSourceCited = true;
    return {
      name, state: correct ? 'correct' : 'wrong', value: claim.value,
      ...(claim.pair === undefined
        ? { citation: 'missing-marker' }
        : { marker: claim.pair.marker, citation: claim.pair.citation }),
    };
  });
  return { fields, markers, instructedSourceCited };
}
