/** The inputs layer's one label for a fill that reads more than its window. */

/**
 * How a fill reads MORE than its window, for the note: widened before the call
 * (`reads-more`; `tool-trims` when the tool drops the rows outside the asked
 * window), or lengthened at dispatch for a length-only form (`source-clock`;
 * `source-clock-trims`). `undefined` for an exact fill.
 */
export function widerOf(
  conversion: { readonly coversAtDispatch?: true },
  trimmedByTool: boolean,
): 'reads-more' | 'tool-trims' | 'source-clock' | 'source-clock-trims' | undefined {
  if (conversion.coversAtDispatch === true) {
    return trimmedByTool ? 'source-clock-trims' : 'source-clock';
  }
  if (!('sent' in conversion)) return undefined;
  return trimmedByTool ? 'tool-trims' : 'reads-more';
}
