/**
 * `'<namespace>#<id>'`.
 *
 * The namespace is in the KEY as well as in the metadata, and the redundancy is
 * deliberate: `search` filters server-side on the metadata, while `list` and
 * `forget` need to select a namespace out of a page of keys, which ListVectors
 * gives no filter for.
 */
export function vectorKey(namespace: string, id: string): string {
  return `${namespace}#${id}`;
}
