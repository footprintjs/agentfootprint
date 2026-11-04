import type { Tool } from '../../tools/tools.js';
import { defineTool } from '../../tools/tools.js';
import { TOOLPACK_HARD_CAPS } from '../types.js';
import { clampParam, displayText } from '../bounded.js';
import { truncateText } from './valueLines.js';
import { NARRATIVE_LINE_CHAR_CAP } from './structuralLimits.js';

// ── read_narrative ─────────────────────────────────────────────────────────

function buildReadNarrative(narrative: readonly string[]): Tool {
  return defineTool<{ offset?: number; maxLines?: number }, string>({
    name: 'read_narrative',
    description:
      "Read the run's human-readable narrative, paginated: offset (0-based line index) + " +
      `maxLines (default 40, hard cap ${TOOLPACK_HARD_CAPS.narrativeMaxLines}). Long lines are ` +
      'capped. Use AFTER the structured tools when you need the story around a step.',
    inputSchema: {
      type: 'object',
      properties: {
        offset: { type: 'integer', description: '0-based first line to read (default 0).' },
        maxLines: {
          type: 'integer',
          description: `Lines to read (default 40, hard cap ${TOOLPACK_HARD_CAPS.narrativeMaxLines}).`,
        },
      },
      additionalProperties: false,
    },
    execute: ({ offset, maxLines }) => {
      const total = narrative.length;
      if (total === 0) return 'NARRATIVE: empty (0 lines).';
      const start = clampParam(offset, 0, 0, Math.max(0, total - 1));
      const count = clampParam(maxLines, 40, 1, TOOLPACK_HARD_CAPS.narrativeMaxLines);
      const slice = narrative.slice(start, start + count);
      const lines = [
        `NARRATIVE lines ${start}–${start + slice.length - 1} of ${total}:`,
        ...slice.map((line) => truncateText(displayText(line), NARRATIVE_LINE_CHAR_CAP)),
      ];
      const remaining = total - (start + slice.length);
      if (remaining > 0) {
        lines.push(
          `…${remaining} more line(s) — call read_narrative({ offset: ${start + slice.length} }).`,
        );
      }
      return lines.join('\n');
    },
  });
}

export { buildReadNarrative };
