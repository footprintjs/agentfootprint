/**
 * findings/peel — the answer's `_findings` peel and the stream's filter, in
 * the ONE module an unarmed agent never loads.
 *
 * Both run `answerText.ts`'s scanner, which only `.findings()` agents use.
 * The stages that need it (`callLLM`, `route`) load this module through
 * `import()` when the arm is on — the optional-family law of docs-next's site
 * budget, the same as `judge.ts` and `toolChoice/compose.ts` — so a plain
 * agent's bundle carries none of it. Keep every static import of
 * `answerText.ts` inside this file and `answerText.ts` itself;
 * test/core/agent/findings/peel-lazy.test.ts pins that.
 */

import type { FindingsDeclaration } from './types.js';
import { RESERVED_ANSWER_KEY } from './types.js';
import { readDeclaration, type ReadDeclaration } from './reserved.js';
import { withoutReservedMembers, type RemovedMember } from './answerText.js';

export { reservedMemberFilter, withoutReservedMembers } from './answerText.js';

export interface PeeledAnswer {
  /** `raw` itself unless a `_findings` member was taken out of it. */
  readonly content: string;
  readonly findings?: FindingsDeclaration;
  readonly malformed?: number;
}

/**
 * Take the answer's `_findings` off, wherever the answer's TEXT carries it
 * (9.114.2; `answerText.ts` is the rule, shared with the stream). Every JSON
 * object in the answer that is not inside another object — the whole answer,
 * a code block holding one, one written in the prose — loses its own
 * `_findings` member and the separator that joined it, and nothing else moves:
 * the model's layout and the prose around it stay as written. Identity when
 * nothing was removed.
 *
 * The removed values are the answer's declaration: per object the LAST one
 * (JSON's own rule for a repeated key — what a whole-answer `JSON.parse` read
 * before 9.114.2), across objects in text order, their `previous` lists
 * joined. A value that is not JSON, or that a cut-off text left unfinished, is
 * dropped and counted (`malformed`), never guessed at.
 */
export function peelAnswerFindings(raw: string): PeeledAnswer {
  if (typeof raw !== 'string') return { content: raw };
  const { text, removed } = withoutReservedMembers(raw, RESERVED_ANSWER_KEY);
  if (removed.length === 0) return { content: raw };
  const lastPerObject = new Map<number, RemovedMember>();
  for (const member of removed) lastPerObject.set(member.object, member);
  let findings: FindingsDeclaration | undefined;
  let malformed = 0;
  for (const member of lastPerObject.values()) {
    const read = readRemovedValue(member);
    malformed += read.malformed;
    if (read.declaration !== undefined) findings = joinDeclarations(findings, read.declaration);
  }
  return {
    content: text,
    ...(findings !== undefined && { findings }),
    ...(malformed > 0 && { malformed }),
  };
}

/** One removed value, read as a declaration — or counted, when it cannot be read. */
function readRemovedValue(member: RemovedMember): ReadDeclaration {
  if (!member.complete) return { malformed: 1 };
  let value: unknown;
  try {
    value = JSON.parse(member.valueText);
  } catch {
    return { malformed: 1 };
  }
  return readDeclaration(value);
}

/** Two objects' declarations as one: later fields win, `previous` lists join in text order. */
function joinDeclarations(
  earlier: FindingsDeclaration | undefined,
  later: FindingsDeclaration,
): FindingsDeclaration {
  if (earlier === undefined) return later;
  const previous =
    earlier.previous === undefined && later.previous === undefined
      ? undefined
      : [...(earlier.previous ?? []), ...(later.previous ?? [])];
  return { ...earlier, ...later, ...(previous !== undefined && { previous }) };
}
