import type { TraceToolpackArtifacts } from '../types.js';
import type { ToolpackIndex } from './packIndex.js';
import type { Tool } from '../../tools/tools.js';
import { defineTool } from '../../tools/tools.js';
import {
  FIND_HITS_DEFAULT,
  FIND_QUERY_MIN_CHARS,
  FIND_QUERY_MAX_CHARS,
  FIND_CONTEXT_RADIUS,
  FIND_SCAN_BUDGET,
} from './structuralLimits.js';
import { TOOLPACK_HARD_CAPS } from '../types.js';
import { clampParam, displayKey, safeStringify, displayText } from '../bounded.js';
import { redactionNote } from './valueLines.js';

/** A bounded window of `text` around the first case-insensitive match. */
function matchWindow(text: string, needleLower: string, radius: number): string | undefined {
  const at = text.toLowerCase().indexOf(needleLower);
  if (at < 0) return undefined;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + needleLower.length + radius);
  return (
    (start > 0 ? '…' : '') +
    text.slice(start, end).replace(/\s+/g, ' ') +
    (end < text.length ? '…' : '')
  );
}

// ── find_in_trace ──────────────────────────────────────────────────────────

/**
 * The missing FIRST move.
 *
 * Every other tool needs a name you already have: a step id, a state key,
 * a variable. But a follow-up question arrives in the user's words — "why
 * did you say order 7712 was out of warranty?" — and the model's only
 * options were to guess a key or read the whole narrative. This is the
 * bridge from free text to ids: search the record, hand back POINTERS.
 *
 * Three properties make it a search rather than a dump:
 *
 *   - it serves a bounded WINDOW around each match, never the value;
 *   - every hit line ends with the exact next call to make, so a search
 *     result is a menu of drills rather than an answer to be believed;
 *   - it searches the REDACTED commit log, because that is the only copy
 *     that exists — a redacted value reads as its placeholder here for
 *     the same reason it does everywhere else.
 *
 * The zero-hit answer is the honest one: it names what never enters the
 * record at all, so "not found" cannot be read as "did not happen".
 */
function buildFindInTrace(artifacts: TraceToolpackArtifacts, index: ToolpackIndex): Tool {
  return defineTool<{ query: string; maxHits?: number }, string>({
    name: 'find_in_trace',
    description:
      'Search this run\'s record for free text — "7712", "out of stock", a phrase from the ' +
      'answer — and get back the step ids and keys where it appears. Searches stage names and ' +
      'descriptions, state keys, every committed value, and the narrative. Case-insensitive ' +
      `substring; returns up to maxHits pointers (default ${FIND_HITS_DEFAULT}, hard cap ` +
      `${TOOLPACK_HARD_CAPS.findMaxHits}), each with the exact follow-up call to make. Use it ` +
      'FIRST when the question names something the run mentioned but you have no id for.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The text to look for (case-insensitive substring), e.g. an order id, a phrase ' +
            'from the answer, or a tool name.',
        },
        maxHits: {
          type: 'integer',
          description: `Pointers to return (default ${FIND_HITS_DEFAULT}, hard cap ${TOOLPACK_HARD_CAPS.findMaxHits}).`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: ({ query, maxHits }) => {
      const trimmed = query.trim();
      if (trimmed.length < FIND_QUERY_MIN_CHARS) {
        return (
          `find_in_trace: '${trimmed}' is too short to search (minimum ${FIND_QUERY_MIN_CHARS} ` +
          `characters) — a one-character query matches nearly every step, which is the same as ` +
          `no answer. Search for an id, a value, a key, or a phrase from the answer.`
        );
      }
      const needle = trimmed.slice(0, FIND_QUERY_MAX_CHARS).toLowerCase();
      const cap = clampParam(maxHits, FIND_HITS_DEFAULT, 1, TOOLPACK_HARD_CAPS.findMaxHits);

      const hits: string[] = [];
      let scans = 0;
      let budgetHit = false;
      /** Record a hit; true once the cap is reached and scanning should stop. */
      const add = (line: string): boolean => {
        hits.push(line);
        return hits.length >= cap;
      };

      // 1. STAGES — what the run's steps are called and what they claim to do.
      let full = false;
      for (const group of index.groups) {
        const haystack = `${group.stagePart} ${group.name ?? ''} ${group.description ?? ''}`;
        const window = matchWindow(haystack, needle, FIND_CONTEXT_RADIUS);
        if (window === undefined) continue;
        if (add(`- stage: ${window} → trace_node('${group.ids[0]}')`)) {
          full = true;
          break;
        }
      }

      // 2. STATE KEYS — the names, not the values (those are step 3).
      if (!full) {
        for (const path of index.knownPaths) {
          const dotted = displayKey(path);
          if (!dotted.toLowerCase().includes(needle)) continue;
          if (add(`- state key '${dotted}' → who_wrote('${dotted}')`)) {
            full = true;
            break;
          }
        }
      }

      // 3. COMMITTED VALUES — what each step actually wrote. Serialized ONE
      //    (step, key) payload at a time and discarded: a search must never
      //    build a serialization of the whole log to look through.
      if (!full) {
        outer: for (const bundle of index.commitLog) {
          const overwrite = bundle.overwrite as Record<string, unknown> | undefined;
          const updates = bundle.updates as Record<string, unknown> | undefined;
          for (const entry of bundle.trace) {
            if (scans >= FIND_SCAN_BUDGET) {
              budgetHit = true;
              break outer;
            }
            scans++;
            const payload = overwrite?.[entry.path] ?? updates?.[entry.path];
            if (payload === undefined) continue;
            const window = matchWindow(safeStringify(payload), needle, FIND_CONTEXT_RADIUS);
            if (window === undefined) continue;
            const dotted = displayKey(entry.path);
            if (
              add(
                `- ${bundle.runtimeStageId} wrote '${dotted}' (${entry.verb}): ${displayText(
                  window,
                )}${redactionNote([bundle], entry.path)} → get_value('${
                  bundle.runtimeStageId
                }', '${dotted}')`,
              )
            ) {
              full = true;
              break outer;
            }
          }
        }
      }

      // 4. NARRATIVE — the story, when the artifacts carry one.
      const narrative = artifacts.narrative;
      if (!full && narrative !== undefined) {
        for (let i = 0; i < narrative.length; i++) {
          const window = matchWindow(narrative[i], needle, FIND_CONTEXT_RADIUS);
          if (window === undefined) continue;
          if (
            add(`- narrative line ${i}: ${displayText(window)} → read_narrative({ offset: ${i} })`)
          ) {
            full = true;
            break;
          }
        }
      }

      const scope =
        `${index.groups.length} stage(s), ${index.knownPaths.size} state key(s), ` +
        `${index.commitLog.length} committed step(s)` +
        (narrative !== undefined ? `, ${narrative.length} narrative line(s)` : '');

      if (hits.length === 0) {
        return (
          `find_in_trace: no match for '${trimmed}' — searched ${scope}.\n` +
          (budgetHit
            ? `⚠ the value scan stopped after ${FIND_SCAN_BUDGET} writes, so this is "not found ` +
              `so far", not "not present" — narrow the query or drill with run_overview.\n`
            : '') +
          `⚠ some things NEVER enter the record and cannot be found here: run input (args), env, ` +
          `state seeded before the run, values carried in closures, and anything redaction removed ` +
          `(those read as their placeholder). Tool internals are not traced either — only the ` +
          `arguments in and the result out.\n` +
          `Try a shorter phrase, a key from run_overview, or read_narrative for the story.`
        );
      }

      const lines = [
        `FOUND ${hits.length}${hits.length >= cap ? '+' : ''} match(es) for '${trimmed}' ` +
          `in ${scope} — each line ends with the call that opens it:`,
        ...hits,
      ];
      if (hits.length >= cap) {
        lines.push(
          `⚠ stopped at maxHits ${cap} — more matches may exist. Narrow the query, or raise ` +
            `maxHits (hard cap ${TOOLPACK_HARD_CAPS.findMaxHits}).`,
        );
      }
      if (budgetHit) {
        lines.push(
          `⚠ the value scan stopped after ${FIND_SCAN_BUDGET} writes — later steps were not ` +
            `searched. Narrow the query or drill from run_overview.`,
        );
      }
      return lines.join('\n');
    },
  });
}

export { buildFindInTrace };
