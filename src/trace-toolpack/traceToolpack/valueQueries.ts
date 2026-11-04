import type { ToolpackIndex } from './packIndex.js';
import type { ResolvedToolpackOptions } from '../types.js';
import type { Tool } from '../../tools/tools.js';
import { defineTool } from '../../tools/tools.js';
import { keyProperty, idProperty } from './parameterSchemas.js';
import {
  normalizeKey,
  displayKey,
  boundedPreview,
  displayText,
  renderPreview,
  clampParam,
  safeStringify,
} from '../bounded.js';
import { unknownIdMessage, unknownKeySuffix } from './navigationHints.js';
import { anchorIdxFor } from './packIndex.js';
import { findLastWriterWithBasis, commitValueAtWithBasis } from 'foottrace';
import { basisLines, untrackedSourcesOf, redactionNote, honestyLine } from './valueLines.js';
import { writtenInsideLine, mergeBackLine } from './writerHints.js';
import { TOOLPACK_HARD_CAPS } from '../types.js';

function buildWhoWrote(index: ToolpackIndex, opts: ResolvedToolpackOptions): Tool {
  return defineTool<{ key: string; beforeStageId?: string }, string>({
    name: 'who_wrote',
    description:
      'Find the LAST step that wrote a state key — optionally before a given step ' +
      '(beforeStageId), for "who set this value that step X then read?" questions. Returns ' +
      'the writer step id + stage name + write verb + a bounded value preview.',
    inputSchema: {
      type: 'object',
      properties: {
        key: keyProperty(index, "The state key, e.g. 'dti' or 'customer.address.zip'."),
        beforeStageId: idProperty(
          index,
          'Optional: only consider writes strictly BEFORE this step.',
        ),
      },
      required: ['key'],
      additionalProperties: false,
    },
    execute: ({ key, beforeStageId }) => {
      const path = normalizeKey(key, index.knownPaths);
      let beforeIdx: number | undefined;
      if (beforeStageId !== undefined) {
        if (!index.firstIdxOf.has(beforeStageId) && !index.nodes.has(beforeStageId)) {
          return unknownIdMessage(beforeStageId, index);
        }
        beforeIdx = anchorIdxFor(beforeStageId, index);
      }

      const { writer, basis } = findLastWriterWithBasis(index.commitLog, path, beforeIdx);
      if (!writer) {
        return (
          `no tracked write to '${displayKey(path)}'` +
          (beforeStageId !== undefined ? ` before ${beforeStageId}` : '') +
          ` in the commit log.` +
          (index.knownPaths.has(path) ? '' : unknownKeySuffix(index)) +
          basisLines(index, basis) +
          writtenInsideLine(index, path, beforeIdx)
        );
      }

      const writerIdx = index.commitLog.indexOf(writer);
      const verb = writer.trace.find((entry) => entry.path === path)?.verb ?? 'set';
      const read = commitValueAtWithBasis(index.commitLog, writerIdx, path, {
        initialState: index.initialState,
      });
      const preview = boundedPreview(read.value, opts.previewChars);
      const untracked = untrackedSourcesOf([writer]);
      return (
        `'${displayKey(path)}' was last written by ${writer.runtimeStageId} — "${writer.stage}" ` +
        `(verb: ${verb}): ${displayText(
          renderPreview(
            preview,
            `get_value('${writer.runtimeStageId}', '${displayKey(path)}') for full`,
          ),
        )}${redactionNote([writer], path)}` +
        basisLines(index, [...basis, ...read.basis]) +
        (untracked.length > 0
          ? `\n⚠ that step also consumed ${untracked.join('/')}. ${honestyLine(
              index,
              'incomplete-sources',
            )}`
          : '') +
        mergeBackLine(index, writer.runtimeStageId, path)
      );
    },
  });
}

// ── get_value ──────────────────────────────────────────────────────────────

function buildGetValue(index: ToolpackIndex, opts: ResolvedToolpackOptions): Tool {
  return defineTool<{ runtimeStageId: string; key: string; maxChars?: number }, string>({
    name: 'get_value',
    description:
      'Fetch the FULL value of a state key as of a given step (verb-aware reconstruction — ' +
      'works on delta commit logs). Output is capped at maxChars ' +
      `(default ${opts.valueMaxChars}, hard cap ${TOOLPACK_HARD_CAPS.valueMaxChars}) with an ` +
      'explicit truncation notice. Prefer fetching a narrower nested key over raising the cap.',
    inputSchema: {
      type: 'object',
      properties: {
        runtimeStageId: idProperty(index, 'The step whose post-commit view of the key you want.'),
        key: keyProperty(index, "The state key, e.g. 'dti' or 'customer.address.zip'."),
        maxChars: {
          type: 'integer',
          description: `Optional char budget (default ${opts.valueMaxChars}, hard cap ${TOOLPACK_HARD_CAPS.valueMaxChars}).`,
        },
      },
      required: ['runtimeStageId', 'key'],
      additionalProperties: false,
    },
    execute: ({ runtimeStageId, key, maxChars }) => {
      const known = index.firstIdxOf.has(runtimeStageId) || index.nodes.has(runtimeStageId);
      if (!known) return unknownIdMessage(runtimeStageId, index);

      const path = normalizeKey(key, index.knownPaths);
      const cap = clampParam(maxChars, opts.valueMaxChars, 50, TOOLPACK_HARD_CAPS.valueMaxChars);
      const lastIdx = index.lastIdxOf.get(runtimeStageId);
      const atIdx = lastIdx !== undefined ? lastIdx : anchorIdxFor(runtimeStageId, index) - 1;

      // Nested rows count (footprintjs 9.33.0): a key written only through paths inside it —
      // a subflow seed, a merge-back — is written, though no row names it exactly.
      const lastWrite = findLastWriterWithBasis(index.commitLog, path);
      if (!lastWrite.writer) {
        return (
          `no tracked write to '${displayKey(path)}' anywhere in the commit log.` +
          (index.knownPaths.has(path) ? '' : unknownKeySuffix(index)) +
          basisLines(index, lastWrite.basis)
        );
      }

      const read =
        atIdx >= 0
          ? commitValueAtWithBasis(index.commitLog, atIdx, path, {
              initialState: index.initialState,
            })
          : undefined;
      const value = read?.value;
      if (value === undefined) {
        return (
          `'${displayKey(path)}' has no value as of ${runtimeStageId}` +
          ` (last writer over the whole run: ${lastWrite.writer.runtimeStageId}).` +
          basisLines(index, read?.basis ?? ['never-written'])
        );
      }

      const serialized = displayText(safeStringify(value));
      const redacted = redactionNote(index.bundlesOf.get(runtimeStageId), path);
      const header = `VALUE of '${displayKey(path)}' as of ${runtimeStageId}${redacted}:`;
      const basis = basisLines(index, read?.basis ?? []);
      if (serialized.length <= cap) return `${header}\n${serialized}${basis}`;
      return (
        `${header}\n${serialized.slice(0, cap)}\n` +
        `⚠ truncated: served ${cap} of ${serialized.length} chars — raise maxChars ` +
        `(hard cap ${TOOLPACK_HARD_CAPS.valueMaxChars}) or fetch a narrower nested key.` +
        basis
      );
    },
  });
}

export { buildWhoWrote, buildGetValue };
