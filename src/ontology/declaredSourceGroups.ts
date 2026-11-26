import type { OntologySpec } from './types.js';

interface DeclaredSourceGroup {
  readonly source: string;
  readonly tools: readonly string[];
  readonly equivalents?: readonly string[];
}

interface Declaration {
  readonly kind: 'term' | 'source';
  readonly id: string;
  readonly aliases: readonly string[] | undefined;
}

interface Mention {
  readonly declaration: Declaration;
  readonly start: number;
  readonly end: number;
}

// Bound work on the question and on repeated names before sorting the matches.
const MAX_QUESTION_CODE_UNITS = 65_536;
const MAX_MENTIONS = 4_096;

/** Whole declared strings, with the same separator and plural rules as the ontology score. */
function patternOf(name: string, flags: 'i' | 'gi'): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[ _-]');
  return new RegExp(`(?<![\\w])${escaped}s?(?![\\w])`, flags);
}

export function mentionsDeclaredName(text: string, names: readonly string[]): boolean {
  return names.some((name) => patternOf(name, 'i').test(text));
}

function explicitDeclarations(ontology: OntologySpec, question: string): readonly Declaration[] {
  if (question.length > MAX_QUESTION_CODE_UNITS) return [];
  const declarations: Declaration[] = [
    ...Object.entries(ontology.nodes).map(([id, { aliases }]) => ({
      id,
      aliases,
      kind: 'term' as const,
    })),
    ...Object.entries(ontology.sources).map(([id, { aliases }]) => ({
      id,
      aliases,
      kind: 'source' as const,
    })),
  ];
  const mentions: Mention[] = [];
  for (const declaration of declarations) {
    for (const name of new Set([declaration.id, ...(declaration.aliases ?? [])])) {
      const pattern = patternOf(name, 'gi');
      let match = pattern.exec(question);
      while (match !== null) {
        if (mentions.length === MAX_MENTIONS) return [];
        mentions.push({ declaration, start: match.index, end: match.index + match[0].length });
        // Resume after the start so a later occurrence of this alias can overlap it.
        pattern.lastIndex = match.index + 1;
        match = pattern.exec(question);
      }
    }
  }

  // Aliases of one declaration can overlap without changing the named source.
  // With competing declarations, a single longest phrase must contain all
  // other matches in the span, and it cannot be shared. Separate spans
  // are evaluated independently.
  mentions.sort((a, b) => a.start - b.start || b.end - a.end);
  const explicit = new Set<Declaration>();
  let index = 0;
  let first = mentions[index++];
  while (first !== undefined) {
    let end = first.end;
    let competing = false;
    let sharedLongest = false;
    let overlap = mentions[index];
    while (overlap !== undefined && overlap.start < end) {
      end = Math.max(end, overlap.end);
      if (overlap.declaration !== first.declaration) {
        competing = true;
        sharedLongest ||= overlap.start === first.start && overlap.end === first.end;
      }
      overlap = mentions[++index];
    }
    if (!competing || (!sharedLongest && end === first.end)) explicit.add(first.declaration);
    first = mentions[index++];
  }
  return [...explicit];
}

/**
 * Direct ontology holdings named in the question supply offer candidates.
 * Other declared holders of the same source can establish a source attempt.
 * The request that served a tool still owns offer identity and visibility.
 */
export function declaredSourceGroups(
  ontology: OntologySpec,
  question: string,
): readonly DeclaredSourceGroup[] {
  const terms = new Set<string>();
  const sources = new Set<string>();
  for (const { kind, id } of explicitDeclarations(ontology, question)) {
    (kind === 'term' ? terms : sources).add(id);
  }
  if (terms.size === 0 && sources.size === 0) return [];

  const groups = new Map<string, Set<string>>();
  const holdersBySource = new Map<string, Set<string>>();
  for (const [id, node] of Object.entries(ontology.nodes)) {
    for (const { source, via } of node.sources ?? []) {
      if (via === undefined || via.length === 0) continue;
      const holders = holdersBySource.get(source) ?? new Set<string>();
      for (const tool of via) holders.add(tool);
      holdersBySource.set(source, holders);

      if (!terms.has(id) && !sources.has(source)) continue;
      const tools = groups.get(source) ?? new Set<string>();
      for (const tool of via) tools.add(tool);
      groups.set(source, tools);
    }
  }
  return Array.from(groups, ([source, tools]) => {
    const holders = holdersBySource.get(source);
    return {
      source,
      tools: [...tools],
      ...(holders !== undefined && holders.size > tools.size && { equivalents: [...holders] }),
    };
  });
}
