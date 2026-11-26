/** Whole generated documents are source inventories, not authored explanations. */
export function isAuthoredDocument(raw) {
  const header = raw
    .trimStart()
    .replace(/^#{1,6}[ \t]+[^\r\n]*(?:\r?\n|$)/, '')
    .trimStart();
  return !/^<!--\s*(?:GENERATED|DERIVED)\s+by\b[\s\S]*?-->/i.test(header);
}
