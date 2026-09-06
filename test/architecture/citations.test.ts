/**
 * THE POINTERS — every `file · symbol` written in `src/` or on the roles page
 * names a file that exists and a symbol that is really in it, and no pointer on
 * those surfaces is a line number.
 *
 * WHY A TEST, AND WHY IT CHANGED SHAPE. The role headers this repo carries are
 * mostly pointers: "the one owner is HERE, its consumers read it THERE". A
 * pointer is the load-bearing half of that claim. The first version of this
 * guard checked `file:line` citations — that the file existed, the line was in
 * range, and the line was not blank, a lone `*` or a closing brace. It passed
 * green while nine pointers across four folder READMEs were wrong, every one of
 * them short by exactly the number of comment lines the same pass had inserted
 * above its target. Each landed inside the target function's docblock, which is
 * not filler by any of those rules, so the guard could not see it. Re-deriving
 * the numbers would only have reset the clock: a line number rots the moment
 * anyone adds a comment.
 *
 * THE RULE THIS GUARD ENFORCES: comments, READMEs and design notes cite
 * `file · symbol` — a function, const, interface, or the first words of a named
 * comment banner in quotes. Never `file:line`. A symbol survives every edit
 * above it, and when it is renamed or deleted THIS TEST FAILS, which a line
 * number never could.
 *
 * WHAT A GREEN RUN PROVES: every citation names a file this repo can resolve
 * unambiguously (a bare basename several files answer to is a failure, not a
 * silent skip), the symbol or quoted banner text really occurs in that file, and
 * no `file:NNN` pointer has crept back onto a scanned surface.
 *
 * WHAT A GREEN RUN DOES NOT PROVE: that the symbol means what the sentence
 * around it says. A pointer at a real but wrong function still passes — the FILE
 * is what is checked, and within it only that the name occurs in a
 * declaration-shaped context (`containsSymbol` · `declarationShaped`), never
 * that it is the right name for the claim being made. That is a reviewer's job,
 * not a test's.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const REPO = join(__dirname, '..', '..');

/**
 * `src/` and the roles page — the two surfaces whose pointers are LIVE, kept in
 * step with the tree as it changes. The rest of `docs/design/` is deliberately
 * out: those pages are dated records of a decision (`2026-09-recorded-not-built.md`
 * says so in its name), and a record is allowed to cite the tree as it stood on
 * the day it was written.
 */
const SCAN_ROOTS = [join(REPO, 'src')];
const SCAN_FILES = [join(REPO, 'docs', 'design', 'map-walker-trace-fold-lens.md')];
const RESOLVE_ROOTS = ['src', 'test', 'docs', 'examples'];
const SKIP_DIR = new Set(['node_modules', 'dist', '__fixtures__']);

/**
 * A citation: a path ending `.ts` / `.tsx` / `.md`, a `·`, then the symbol —
 * backticked, quoted (straight or curly), or a bare dotted identifier.
 */
const CITATION =
  /([A-Za-z0-9_.\-/]+\.(?:ts|tsx|md))`?\s*·\s*(?:`([^`]+)`|"([^"]+)"|“([^”]+)”|([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*))/g;

/** The banned form, quoted back at whoever writes it again. */
const LINE_CITATION = /[A-Za-z0-9_.\-/]+\.(?:ts|tsx|md):\d+/g;

/** `·` also separates list items. `a.ts · b.ts` is a list, not a citation. */
const LOOKS_LIKE_A_PATH = /\.(?:ts|tsx|md)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) walk(join(dir, e.name), out);
    } else if (/\.(ts|md)$/.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

/**
 * One line of text per source line, with comment leaders stripped, joined by
 * single spaces — so a citation or a banner quote that WRAPS across lines is
 * still one string. `at(offset)` maps back to the original 1-based line.
 */
interface Flat {
  readonly text: string;
  at(offset: number): number;
}

function flatten(source: string): Flat {
  const lines = source.split('\n');
  const starts: number[] = [];
  const parts: string[] = [];
  let cursor = 0;
  for (const line of lines) {
    const stripped = line.replace(/^\s*(?:\/\/+|\*\/|\/\*\*?|\*|>)?\s*/, '');
    starts.push(cursor);
    parts.push(stripped);
    cursor += stripped.length + 1;
  }
  return {
    text: parts.join(' '),
    at(offset: number): number {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid]! <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    },
  };
}

/** Every file a citation could name, indexed by basename, for the bare forms. */
function indexByBasename(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const root of RESOLVE_ROOTS) {
    const abs = join(REPO, root);
    if (!existsSync(abs)) continue;
    for (const f of walk(abs)) {
      const base = f.slice(f.lastIndexOf('/') + 1);
      const rows = index.get(base);
      if (rows) rows.push(f);
      else index.set(base, [f]);
    }
  }
  return index;
}

const BY_BASENAME = indexByBasename();

type Resolution =
  | { readonly kind: 'found'; readonly path: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] };

function targetOf(citingFile: string, cited: string): Resolution {
  const beside = resolve(dirname(citingFile), cited);
  if (existsSync(beside) && statSync(beside).isFile()) return { kind: 'found', path: beside };
  const fromRoot = join(REPO, cited);
  if (existsSync(fromRoot) && statSync(fromRoot).isFile()) return { kind: 'found', path: fromRoot };
  const base = cited.slice(cited.lastIndexOf('/') + 1);
  const candidates = (BY_BASENAME.get(base) ?? []).filter((c) =>
    cited.includes('/') ? c.endsWith(`/${cited}`) : true,
  );
  if (candidates.length === 1) return { kind: 'found', path: candidates[0]! };
  if (candidates.length > 1) return { kind: 'ambiguous', candidates };
  return { kind: 'missing' };
}

interface Citation {
  readonly from: string;
  readonly fromLine: number;
  readonly text: string;
  readonly cited: string;
  readonly symbol: string;
  /** Was it written bare (no backticks or quotes)? Kept for the message; the
   *  MATCHING rule keys on `IDENTIFIER_LIKE`, not on this. */
  readonly bare: boolean;
}

function scannedFiles(): readonly string[] {
  return [...SCAN_ROOTS.flatMap((root) => walk(root)), ...SCAN_FILES];
}

function citations(): readonly Citation[] {
  const found: Citation[] = [];
  for (const file of scannedFiles()) {
    const flat = flatten(readFileSync(file, 'utf8'));
    for (const m of flat.text.matchAll(CITATION)) {
      const symbol = (m[2] ?? m[3] ?? m[4] ?? m[5])!;
      if (LOOKS_LIKE_A_PATH.test(symbol)) continue; // a list, not a citation
      const at = m.index!;
      found.push({
        from: file,
        fromLine: flat.at(at),
        text: flat.text.slice(Math.max(0, at - 20), at + m[0]!.length + 20).trim(),
        cited: m[1]!,
        symbol,
        bare: m[5] !== undefined,
      });
    }
  }
  return found;
}

/** Normalised for substring matching: runs of whitespace become one space. */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ');
}

const rx = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Ordinary English words that are not symbols. `·` is also used as prose
 * emphasis ("on the record in x.test.ts · the LEDGER entry for …"), and the
 * citation grammar cannot tell that apart from a pointer — so a symbol that is
 * one of these is refused as MALFORMED rather than resolved. Without this,
 * `\bthe\b` matches almost any file and the citation passes vacuously.
 */
const NOT_A_SYMBOL = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'is', 'it',
  'its', 'not', 'of', 'on', 'one', 'or', 'that', 'the', 'their', 'them',
  'these', 'this', 'those', 'to', 'what', 'when', 'where', 'which', 'why',
  'with',
]);

/**
 * A bare identifier must occur in a DECLARATION-SHAPED context, not merely
 * somewhere in the bytes. The loose `\bSYM\b` this replaced tested the raw
 * source — comments, imports and prose included — so any English word passed
 * against almost any file: `src/lib/spokenIds.ts` · `numbered`, a word that
 * occurs there only inside a comment, resolved green.
 *
 * Shapes accepted: a `function` / `const` / `let` / `var` / `class` /
 * `interface` / `type` / `enum` / `namespace` declaration; a property, method,
 * parameter or arrow binding (`SYM:`, `SYM(`, `SYM =`, `SYM<`); and a named
 * import/export specifier. Anything else is a word, not a symbol.
 *
 * A DOTTED name is exempt from that and matched on occurrence alone: it is not
 * an English word, it cannot land by accident, and it is normally cited at a USE
 * (`SUBFLOW_IDS.TOOLS`, an event id in a string literal) rather than where it
 * was declared.
 */
function declarationShaped(source: string, symbol: string): boolean {
  const s = rx(symbol);
  // A DOTTED name — `SUBFLOW_IDS.TOOLS`, `Agent.create`, an event id like
  // `agentfootprint.integrity.disposition` — is not an English word and cannot
  // land by accident, and it is usually cited at a USE (a property read, a
  // string literal) rather than at its declaration. Occurrence is enough.
  if (symbol.includes('.')) return new RegExp(`\\b${s}\\b`).test(source);
  const declared = new RegExp(
    `(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?` +
      `(?:function\\s*\\*?|const|let|var|class|interface|type|enum|namespace)\\s+${s}\\b`,
  );
  const bound = new RegExp(`\\b${s}\\s*\\??\\s*[:(=<]`);
  const specifier = new RegExp(`(?:export|import)[^\\n]*\\{[^}]*\\b${s}\\b`, 's');
  return declared.test(source) || bound.test(source) || specifier.test(source);
}

/**
 * An identifier, backticked or bare — `spoken`, `Agent.create`. Backticks are
 * typography, not a different KIND of pointer, so both go through
 * `declarationShaped`; only a QUOTED BANNER (which has spaces or punctuation in
 * it) is matched as a substring, because a banner is prose by definition.
 */
const IDENTIFIER_LIKE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

function containsSymbol(target: string, c: Citation): boolean {
  const source = readFileSync(target, 'utf8');
  if (IDENTIFIER_LIKE.test(c.symbol)) return declarationShaped(source, c.symbol);
  const flat = normalise(flatten(source).text);
  const wanted = normalise(c.symbol);
  return flat.includes(wanted) || normalise(source).includes(wanted);
}

describe('every file · symbol citation still points at something real', () => {
  const all = citations();

  it('finds the citations', () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it('names a file that exists, and names it unambiguously', () => {
    const broken: string[] = [];
    for (const c of all) {
      const r = targetOf(c.from, c.cited);
      const where = `${relative(REPO, c.from)}:${c.fromLine} cites \`${c.cited}\``;
      if (r.kind === 'missing') broken.push(`${where} — no such file`);
      if (r.kind === 'ambiguous') {
        broken.push(
          `${where} — ambiguous: ${r.candidates.length} files answer to that basename ` +
            `(${r.candidates
              .slice(0, 4)
              .map((p) => relative(REPO, p))
              .join(', ')}${r.candidates.length > 4 ? ', …' : ''}). Write the path, not the basename.`,
        );
      }
    }
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('refuses a symbol that is an ordinary English word, not a symbol', () => {
    const wordy = all
      .filter((c) => IDENTIFIER_LIKE.test(c.symbol) && NOT_A_SYMBOL.has(c.symbol.toLowerCase()))
      .map(
        (c) =>
          `${relative(REPO, c.from)}:${c.fromLine} cites ${c.cited} · ${c.symbol}\n` +
          `    (the citing text is: …${c.text}…)`,
      );
    expect(
      wordy,
      `\`·\` after a filename is a CITATION, never prose emphasis. A citation whose symbol is ` +
        `an ordinary English word cannot be checked — \`\\bthe\\b\` matches almost any file, so ` +
        `the pointer would pass vacuously and prove nothing. Name the real symbol (a function, ` +
        `const, interface, or a quoted banner), or rewrite the sentence so the filename is not ` +
        `followed by \`·\`.\n\n` + wordy.join('\n'),
    ).toEqual([]);
  });

  it('names a symbol that is really in that file', () => {
    const bad: string[] = [];
    for (const c of all) {
      if (IDENTIFIER_LIKE.test(c.symbol) && NOT_A_SYMBOL.has(c.symbol.toLowerCase())) continue; // reported above
      const r = targetOf(c.from, c.cited);
      if (r.kind !== 'found') continue; // the test above owns unresolvable files
      if (containsSymbol(r.path, c)) continue;
      bad.push(
        `${relative(REPO, c.from)}:${c.fromLine} cites ${c.cited} · ${c.symbol}, ` +
          `which does not occur in ${relative(REPO, r.path)}\n    (the citing text is: …${c.text}…)`,
      );
    }
    expect(
      bad,
      `A citation naming a symbol that is not in the file it names is a pointer that rotted — ` +
        `the function was renamed, moved or deleted and the sentence beside it was not. Re-read ` +
        `the file and name what is actually there.\n\n` + bad.join('\n'),
    ).toEqual([]);
  });

  it('carries no `file:line` pointers at all', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(LINE_CITATION)) {
            offenders.push(`${relative(REPO, file)}:${i + 1} — \`${m[0]}\`  in: ${line.trim()}`);
          }
        });
    }
    expect(
      offenders,
      `THE CITATION RULE: comments, READMEs and docs cite \`file · symbol\` — a function, const, ` +
        `interface, or the first words of a named comment banner — NEVER \`file:line\`. Line ` +
        `numbers rot the moment anyone adds a comment above the target; symbols do not.\n\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
