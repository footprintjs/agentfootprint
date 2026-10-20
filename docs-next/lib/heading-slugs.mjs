import GithubSlugger from 'github-slugger';

/** Shared heading identities for generated groups and the existing link checker. */
export function headingEntries(content) {
  const slugger = new GithubSlugger();
  const entries = [];
  const noFences = content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, (block) =>
    block.replace(/[^\n]/g, ' '),
  );
  for (const [index, line] of noFences.split('\n').entries()) {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    let text = m[1];
    const explicit = /\{#([\w-]+)\}\s*$/.exec(text);
    if (explicit) {
      entries.push({ index, slug: explicit[1], explicit: true });
      text = text.replace(/\{#[\w-]+\}\s*$/, '');
    }
    text = text
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/\*([^*]*)\*/g, '$1')
      // CommonMark: `_` emphasis never opens/closes inside a word (find_context_errors keeps its underscores)
      .replace(/(^|[^\w])_([^_]+)_(?![\w])/g, '$1$2')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim();
    if (text) entries.push({ index, slug: slugger.slug(text), explicit: false });
  }
  return entries;
}

export function headingSlugs(content) {
  return new Set(headingEntries(content).map((entry) => entry.slug));
}
