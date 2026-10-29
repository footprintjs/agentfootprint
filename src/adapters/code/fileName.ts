/**
 * The one file-name encoder both code adapters stage inputs under.
 *
 * A staged input's name is caller data landing in a filesystem — a local temp
 * directory for `localCodeRunner`, the sandbox's own disk for
 * `agentCoreCodeRunner`. Both turn it into ONE inert segment through this
 * function, so the same name lands under the same file name on either backend
 * and two names never become one file on either.
 */

import { sha256Hex } from '../../lib/sha256.js';

/** Longest file name this adapter will write. Well inside every POSIX
 *  `NAME_MAX`, and the cap this adapter has always used. */
const FILE_NAME_MAX = 120;

/** Marks a name this adapter had to rewrite. Nothing arm A returns may start
 *  with it. */
const ENCODED_FILE_PREFIX = '_enc_';

/** Already one inert segment: no separator, no escape-looking bytes. */
const FILE_NAME_ALREADY_LEGAL = /^[A-Za-z0-9._-]+$/;

/** `.`, `..`, `...` — a name that is nothing but dots. Not a hop once the
 *  separators are gone, but not a name either, so it goes to arm B. */
const DOTS_ONLY = /^\.+$/;

/** Legal AND not the escape character — the set {@link encodeFileName} passes
 *  through untouched. */
const FILE_CHAR_PASSES_THROUGH = /[A-Za-z0-9.-]/;

/**
 * One caller-supplied name → one inert file-name segment, **without ever
 * folding two names into one file**.
 *
 * Separators cannot survive as a parent hop and `a/b` cannot become two
 * segments — the same law `artifacts/scopePath` states for scope tuples,
 * applied to the one other place caller strings become file names in this
 * package. But the old version got there by REPLACING every illegal character
 * with `_`, which meant `a/b.csv` and `a_b.csv` became the same file: the
 * second write clobbered the first's bytes, `stageInputs` answered two manifest
 * entries pointing at one path, and the model's code opened `a/b.csv` and read
 * whatever `a_b.csv` contained. Nothing failed. The computation was simply run
 * against the wrong dataset — which is the worst shape a data bug can take,
 * because the answer still looks like an answer. `.slice(0, 120)` folded the
 * same way for any two names agreeing on their first 120 characters.
 *
 * So this ENCODES instead of sanitising, in two arms whose outputs cannot meet
 * (the shape `safeSessionId` uses in `adapters/hosting/agentcore.ts`):
 *
 *   A. already one legal segment, not claiming to be an encoded name, and not
 *      dots-only → returned BYTE FOR BYTE. This is what keeps the fix from
 *      renaming anything that works today: `dataset.json`, `a_b.json`, every
 *      name `codeRunnerTool` derives from a declared argument, all land at
 *      exactly the path they landed at before.
 *   B. anything else → `_enc_` + an escaped form, where `_` is the escape
 *      character (`_` → `__`, any other illegal UTF-16 unit → `_uXXXX`). A
 *      decoder is a left inverse of that, which is what makes it injective.
 *
 * Arm A never starts with `_enc_` (excluded by construction) and every arm B
 * output does, so no name from one arm can collide with a name from the other.
 * Both arms produce ASCII with no `/`, no `\` and no NUL, so the path-hop law
 * the old version enforced is unchanged.
 */
export function safeFileName(raw: string): string {
  if (
    raw.length <= FILE_NAME_MAX &&
    FILE_NAME_ALREADY_LEGAL.test(raw) &&
    !raw.startsWith(ENCODED_FILE_PREFIX) &&
    !DOTS_ONLY.test(raw)
  ) {
    return raw;
  }
  const encoded = ENCODED_FILE_PREFIX + encodeFileName(raw);
  // Strictly less, so the two shapes below are told apart by LENGTH alone: a
  // digested name is always exactly FILE_NAME_MAX and an escaped one never is.
  if (encoded.length < FILE_NAME_MAX) return encoded;
  // Past the cap no mapping can stay injective — there are more names than
  // there are file names — so the tail becomes a digest of the WHOLE raw name.
  // SHA-256 rather than the package's 32-bit FNV-1a: a name reaching this
  // adapter is caller data, and a 32-bit digest is a collision somebody can go
  // and find, which for a file the model then reads as data is the same defect
  // this function exists to close. `lib/sha256.ts` — the library's own,
  // checked against `node:crypto` — so `agentCoreCodeRunner`, which may run
  // where there is no `node:crypto`, encodes a name exactly as the local runner
  // does.
  const digest = sha256Hex(raw).slice(0, 32);
  return `${encoded.slice(0, FILE_NAME_MAX - digest.length - 2)}_z${digest}`;
}

/** `_` → `__`, anything else illegal → `_uXXXX`. Injective by construction. */
function encodeFileName(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    if (ch === '_') out += '__';
    else if (FILE_CHAR_PASSES_THROUGH.test(ch)) out += ch;
    else out += `_u${raw.charCodeAt(i).toString(16).padStart(4, '0')}`;
  }
  return out;
}
