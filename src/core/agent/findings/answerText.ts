/**
 * findings/answerText — the ONE reader of the reserved key in an answer's
 * TEXT (9.114.2).
 *
 * Pattern: an incremental scanner — a character state machine with no scope
 *          and no I/O, fed chunk by chunk (`reservedMemberFilter`) or whole
 *          (`withoutReservedMembers`), with the same bytes out either way.
 * Role:    core/ layer leaf. `stages/callLLM.ts` feeds it the provider's
 *          stream under the arm, so `agentfootprint.stream.token` never
 *          carries the model's notes; `peel.ts · peelAnswerFindings` feeds
 *          it the whole answer, so the answer the run returns is exactly the
 *          text the stream showed.
 *
 * THE RULE
 *   Every JSON object written in the text — the whole answer, one in a code
 *   block, one in the prose, one in a list — loses its own `_findings` member:
 *   the key, the value and the separator that joined it to its neighbours,
 *   and nothing else. A `_findings` inside another object's VALUE is data and
 *   stays. Each removed value is handed back (`removed`), as written, for the
 *   peel to read as the answer's declaration.
 *
 *   - An object left with nothing in it goes whole — its line too — when it
 *     stood on a line of its own outside any list: the whole answer, a
 *     paragraph of its own, a code block of its own. A code block left empty
 *     goes with its fences. The removed line's indentation and the whole
 *     blank lines after it go; the next line keeps its own indentation. No
 *     blank lines are left at either end of the text. The whole answer, left with nothing, is `{}` (a JSON answer stays
 *     JSON). Anywhere else an emptied object stays as `{}`, so the JSON or
 *     code around it keeps its shape. A string inside a list is read as a
 *     string, so a `]` or `{` in it neither ends the list nor opens an object.
 *   - An answer that held nothing but notes — a code block of them, or
 *     several objects of them — is left empty; only an answer that was one
 *     bare JSON object becomes `{}`.
 *   - Text that stops being JSON part way (`{see below}`, a stray quote or a
 *     raw line break inside a `_findings` value) is given back exactly as it
 *     was written; nothing is removed from it except a `_findings` member
 *     that was already complete. An object that held nothing but such
 *     complete notes when the text stopped being JSON (a model one closing
 *     brace short) ends there, and goes as an emptied object does. Keys and
 *     values are read by JSON's own grammar (`JsonValue`), so the first
 *     character JSON cannot take decides it — not a count of brackets, which
 *     prose may never balance.
 *   - Text that ends inside a `_findings` value that is JSON so far (a
 *     cut-off stream) keeps it hidden and reports it `complete: false`.
 *   - Nothing removed ⇒ the text comes back byte for byte, whatever the
 *     chunking. What is held back while undecided is bounded by a line:
 *     whitespace, a key (a raw line break ends one — JSON allows none), `{`
 *     until its first key is read, a separator, a code fence line, the rest
 *     of an emptied object's line. The one exception is a `_findings` value:
 *     it is never shown while it is JSON so far, and one that stops being
 *     JSON is held until the character that breaks it and then given back as
 *     written — so that hold can span as many lines as the notes do.
 */

import { RESERVED_ANSWER_KEY } from './types.js';

/** One `_findings` member the scanner took out of the text. */
export interface RemovedMember {
  /** Which object in the text held it, counted from 0 in text order. */
  readonly object: number;
  /** The member's value exactly as written — cut short when the text ended inside it. */
  readonly valueText: string;
  /** False when the text ended before the value did. */
  readonly complete: boolean;
}

/** The scanner, fed piece by piece. */
export interface ReservedMemberFilter {
  /** Feed the next piece of text; returns what can be shown now. */
  push(chunk: string): string;
  /** No more text: returns what was held back. After it, every call returns `''`. */
  end(): string;
  /** Every member removed so far, in text order. */
  readonly removed: readonly RemovedMember[];
}

/** A fresh scanner for one text (one provider call's content). */
export function reservedMemberFilter(key: string = RESERVED_ANSWER_KEY): ReservedMemberFilter {
  return new Scanner(key);
}

/** The whole-text form: the text without its reserved members, and what was removed. */
export function withoutReservedMembers(
  text: string,
  key: string = RESERVED_ANSWER_KEY,
): { readonly text: string; readonly removed: readonly RemovedMember[] } {
  const scanner = new Scanner(key);
  const out = scanner.push(text) + scanner.end();
  return { text: out, removed: scanner.removed };
}

// ─── The machine ───────────────────────────────────────────────────────

const WS = new Set([' ', '\t', '\n', '\r']);
/** A JSON number or literal — what a value that is not a string, object or array must be. */
const SCALAR = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/;
/** The start of one: a scalar that stops matching this cannot become JSON. */
const SCALAR_PREFIX =
  /^(?:-|-?(?:0|[1-9]\d*)(?:\.(?:\d+(?:[eE][+-]?\d*)?)?|[eE][+-]?\d*)?|t(?:r(?:ue?)?)?|f(?:a(?:l(?:se?)?)?)?|n(?:u(?:ll?)?)?)$/;
/** Characters that can continue a scalar; anything else ends it. */
const SCALAR_CHAR = /[0-9a-zA-Z.+-]/;
/** What may follow `\` in a JSON string (`u` takes four hex digits). */
const ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);
const HEX = /^[0-9a-fA-F]$/;

/** Where a JSON string's escape stands: 0 none, -1 just after `\`, n > 0 hex digits still owed. */
interface StringState {
  esc: number;
}

/**
 * One character of a JSON string after its opening quote. `end` at the
 * closing quote; `bad` where JSON cannot continue — a raw newline or other
 * control character, or an escape JSON does not have.
 */
function stringChar(s: StringState, ch: string): 'more' | 'end' | 'bad' {
  if (ch < ' ') return 'bad';
  if (s.esc === -1) {
    if (ch === 'u') s.esc = 4;
    else if (ESCAPES.has(ch)) s.esc = 0;
    else return 'bad';
    return 'more';
  }
  if (s.esc > 0) {
    if (!HEX.test(ch)) return 'bad';
    s.esc -= 1;
    return 'more';
  }
  if (ch === '\\') {
    s.esc = -1;
    return 'more';
  }
  return ch === '"' ? 'end' : 'more';
}

/**
 * What one character did to a JSON value being read: `take` it belongs to the
 * value; `end` it closed the value; `after` the value (a number or literal)
 * was already complete and this character is not part of it; `bad` it cannot
 * continue a JSON value.
 */
type ValueStep = 'take' | 'end' | 'after' | 'bad';

type Expect = 'keyOrClose' | 'key' | 'colon' | 'valueOrClose' | 'value' | 'commaOrClose';

/** An object or array open inside the value, and what JSON allows next in it. */
interface Frame {
  readonly close: '}' | ']';
  expect: Expect;
}

/**
 * One JSON value read character by character by JSON's own grammar, so a
 * value that stops being JSON is known at its first wrong character — not
 * only when its brackets fail to balance, which may never happen.
 */
class JsonValue {
  private readonly frames: Frame[] = [];
  private readonly str: StringState = { esc: 0 };
  private inString = false;
  private scalar = '';

  step(ch: string): ValueStep {
    if (this.inString) return this.stringStep(ch);
    if (this.scalar !== '') {
      if (SCALAR_CHAR.test(ch)) return this.scalarStep(ch);
      if (!SCALAR.test(this.scalar)) return 'bad';
      this.scalar = '';
      if (this.frames.length === 0) return 'after';
    }
    const top = this.frames[this.frames.length - 1];
    // Nothing open: this is the value's first character.
    if (top === undefined) return this.startValue(ch);
    if (WS.has(ch)) return 'take';
    if (ch === ',') return this.expecting(top, 'commaOrClose', top.close === '}' ? 'key' : 'value');
    if (ch === ':') return this.expecting(top, 'colon', 'value');
    if (ch === '}' || ch === ']') return this.close(top, ch);
    if (ch === '"' && (top.expect === 'keyOrClose' || top.expect === 'key')) {
      top.expect = 'colon';
      return this.openString();
    }
    return this.startValue(ch);
  }

  private stringStep(ch: string): ValueStep {
    const r = stringChar(this.str, ch);
    if (r !== 'end') return r === 'bad' ? 'bad' : 'take';
    this.inString = false;
    return this.frames.length === 0 ? 'end' : 'take';
  }

  private scalarStep(ch: string): ValueStep {
    if (!SCALAR_PREFIX.test(this.scalar + ch)) return 'bad';
    this.scalar += ch;
    return 'take';
  }

  private expecting(top: Frame, want: Expect, next: Expect): ValueStep {
    if (top.expect !== want) return 'bad';
    top.expect = next;
    return 'take';
  }

  private close(top: Frame, ch: string): ValueStep {
    const closable =
      top.expect === 'keyOrClose' || top.expect === 'valueOrClose' || top.expect === 'commaOrClose';
    if (top.close !== ch || !closable) return 'bad';
    this.frames.pop();
    return this.frames.length === 0 ? 'end' : 'take';
  }

  private openString(): ValueStep {
    this.inString = true;
    this.str.esc = 0;
    return 'take';
  }

  /** A value begins — only where one is expected. */
  private startValue(ch: string): ValueStep {
    const top = this.frames[this.frames.length - 1];
    if (top !== undefined) {
      if (top.expect !== 'value' && top.expect !== 'valueOrClose') return 'bad';
      top.expect = 'commaOrClose';
    }
    if (ch === '"') return this.openString();
    if (ch === '{' || ch === '[') {
      const obj = ch === '{';
      this.frames.push({ close: obj ? '}' : ']', expect: obj ? 'keyOrClose' : 'valueOrClose' });
      return 'take';
    }
    if (!SCALAR_PREFIX.test(ch)) return 'bad';
    this.scalar = ch;
    return 'take';
  }
}

type Mode =
  | 'prose' // text outside any object — in a code block's body too (`inFence`)
  | 'ticks' // a run of backticks at the start of a line
  | 'fenceInfo' // a code fence's opening line, up to its newline
  | 'fenceStart' // whitespace after the opening line, before the block's first character
  | 'object' // inside a scanned object
  | 'lineRest' // after an emptied object: the rest of its line decides whether it goes whole
  | 'fenceAfter' // after a code block's only object went whole
  | 'fenceAfterTicks'; // a run of backticks there

type ObjState = 'key?' | 'key' | 'colon' | 'value?' | 'value' | 'after';

interface ObjectScan {
  readonly index: number;
  /** It began the text: only whitespace before it. */
  readonly initial: boolean;
  /** Only whitespace before it on its line, and no list open around it. */
  readonly ownLine: boolean;
  /** The held opening line of the code block it begins, if it begins one. */
  readonly fence: string | undefined;
  /** `{` and the whitespace after it — held until a member is kept. */
  open: string;
  openHeld: boolean;
  kept: number;
  removed: number;
  state: ObjState;
  /** Whitespace and a comma between members (or before `}`), held until the next key is read. */
  sep: string;
  /** The key string being read, quotes included. */
  key: string;
  keyStr: StringState;
  /** The member being read is `_findings`. */
  reserved: boolean;
  /** A reserved member's text as written, from its separator on — given back if the text stops being JSON. */
  raw: string;
  /** How much of `raw` is the separator before the member (dropped when nothing was kept before it). */
  rawSep: number;
  /** A reserved member's value text. */
  value: string;
  /** The member value being read, by JSON's grammar. */
  reader: JsonValue | undefined;
}

class Scanner implements ReservedMemberFilter {
  readonly removed: RemovedMember[] = [];
  private out = '';
  private ended = false;
  private mode: Mode = 'prose';
  // Prose.
  private pendingWs = '';
  /** A block was removed after `pendingWs` began: that whitespace is kept only if more text follows. */
  private pendingBeforeRemoved = false;
  /** Line breaks dropped after the last removed block (`dropWs`). */
  private droppedNewlines = 0;
  /** The whitespace right after a removed block is dropped — whole blank lines only. */
  private dropWs = false;
  /**
   * While `dropWs` is on: the spaces and tabs since the last newline — the
   * next line's own indentation, which is not the removed block's to take.
   */
  private indentWs = '';
  private lineStart = true;
  private textStart = true;
  /** `[` written in the text and not yet closed — an object inside a list keeps its place. */
  private listDepth = 0;
  /** Inside a string in a list (`listDepth > 0`). */
  private listString = false;
  private readonly listStr: StringState = { esc: 0 };
  /** The text began with an object that went whole — `{}` if nothing else follows. */
  private emptiedInitial = false;
  // Code blocks.
  private inFence = false;
  private fenceTicks = 0;
  private ticks = '';
  private opener = '';
  private tail = '';
  // Objects.
  private obj: ObjectScan | undefined;
  /** The emptied object whose line is being read (`lineRest`). */
  private emptied: ObjectScan | undefined;
  private objects = 0;

  constructor(private readonly key: string) {}

  push(chunk: string): string {
    if (this.ended) return '';
    for (const ch of chunk) this.step(ch);
    return this.flush();
  }

  end(): string {
    if (this.ended) return '';
    this.ended = true;
    switch (this.mode) {
      case 'ticks':
        this.mode = 'prose';
        this.text(this.takeTicks());
        break;
      case 'fenceInfo':
      case 'fenceStart':
        this.releaseWs();
        this.emit(this.opener);
        this.opener = '';
        break;
      case 'object':
        this.endInObject();
        break;
      case 'lineRest': {
        // The emptied object's line ended with the text: it stood alone — and
        // a code block it began never closed, so the block goes too.
        const o = this.emptied as ObjectScan;
        this.goesWhole(o);
        if (o.fence !== undefined) this.removeFencedBlock();
        break;
      }
      case 'fenceAfterTicks':
        if (this.ticks.length >= this.fenceTicks) this.removeFencedBlock();
        else this.keepFencedBlock(this.takeTicks());
        break;
      case 'fenceAfter':
        // The block never closed and held only the removed object.
        this.removeFencedBlock();
        break;
      default:
        break;
    }
    if (this.emptiedInitial) {
      this.dropHeldWs();
      this.emit('{}');
    } else if (this.pendingBeforeRemoved) {
      this.dropHeldWs();
    } else {
      this.releaseWs();
    }
    return this.flush();
  }

  // ─── Output ────────────────────────────────────────────────────────

  private flush(): string {
    const out = this.out;
    this.out = '';
    return out;
  }

  private emit(s: string): void {
    this.out += s;
  }

  /** Whitespace held before now goes out. */
  private releaseWs(): void {
    // After a removed line, the blank line that followed it still keeps the
    // text on either side apart — at most one blank line, and only where text
    // came before the removed line.
    let breaks = '';
    if (this.pendingBeforeRemoved && this.pendingWs.includes('\n')) {
      const have = this.pendingWs.split('\n').length - 1;
      breaks = '\n'.repeat(Math.min(this.droppedNewlines, Math.max(0, 2 - have)));
    }
    this.emit(this.pendingWs + breaks + this.indentWs);
    this.pendingWs = '';
    this.indentWs = '';
    this.droppedNewlines = 0;
    this.pendingBeforeRemoved = false;
    this.dropWs = false;
  }

  /** The text ended after a removed block: the whitespace held goes with it. */
  private dropHeldWs(): void {
    this.pendingWs = '';
    this.indentWs = '';
  }

  /**
   * A removed line's indentation goes with it, so it is not carried onto the
   * next line (four spaces there would make it a code block). The held
   * whitespace is cut back to its last newline.
   */
  private dropRemovedIndent(): void {
    this.pendingWs = this.pendingWs.slice(0, this.pendingWs.lastIndexOf('\n') + 1);
    this.indentWs = '';
  }

  /** Visible text: everything held before it goes out first. */
  private text(s: string): void {
    this.releaseWs();
    this.emit(s);
    this.lineStart = false;
    this.textStart = false;
    this.emptiedInitial = false;
  }

  private takeTicks(): string {
    const t = this.ticks;
    this.ticks = '';
    return t;
  }

  private blockRemoved(): void {
    this.pendingBeforeRemoved = true;
    this.dropWs = true;
    this.droppedNewlines = 0;
  }

  // ─── Dispatch ──────────────────────────────────────────────────────

  private step(ch: string): void {
    switch (this.mode) {
      case 'prose':
        return this.prose(ch);
      case 'ticks':
        return this.ticksStep(ch);
      case 'fenceInfo':
        return this.fenceInfo(ch);
      case 'fenceStart':
        return this.fenceStart(ch);
      case 'object':
        return this.objectStep(ch);
      case 'lineRest':
        return this.lineRest(ch);
      case 'fenceAfter':
        return this.fenceAfter(ch);
      case 'fenceAfterTicks':
        return this.fenceAfterTicks(ch);
    }
  }

  // ─── Prose (a code block's body included) ──────────────────────────

  private prose(ch: string): void {
    if (this.listString) return this.listStringStep(ch);
    if (WS.has(ch)) {
      if (ch === '\n') this.lineStart = true;
      if (!this.dropWs) this.pendingWs += ch;
      else if (ch === '\n' || ch === '\r') {
        this.indentWs = '';
        if (ch === '\n') this.droppedNewlines += 1;
      } else if (this.lineStart) this.indentWs += ch;
      return;
    }
    if (ch === '`' && this.lineStart) {
      this.mode = 'ticks';
      this.ticks = ch;
      this.textStart = false;
      this.emptiedInitial = false;
      return;
    }
    if (ch === '{') return this.openObject(undefined);
    if (ch === '[') this.listDepth += 1;
    else if (ch === ']' && this.listDepth > 0) this.listDepth -= 1;
    else if (ch === '"' && this.listDepth > 0) {
      this.listString = true;
      this.listStr.esc = 0;
    }
    this.text(ch);
  }

  /**
   * A string inside a list: its `[`, `]` and `{` are words, not structure, so
   * the list keeps its depth. A character no JSON string can hold (a raw
   * newline) means this was never a JSON list: it is read as prose from here.
   */
  private listStringStep(ch: string): void {
    const r = stringChar(this.listStr, ch);
    if (r === 'bad') {
      this.listString = false;
      this.listDepth = 0;
      return this.prose(ch);
    }
    if (r === 'end') this.listString = false;
    this.text(ch);
  }

  /** A run of backticks at the start of a line: a fence opens (or closes, inside one). */
  private ticksStep(ch: string): void {
    if (ch === '`') {
      this.ticks += ch;
      return;
    }
    const run = this.takeTicks();
    this.mode = 'prose';
    if (this.inFence) {
      this.text(run);
      if (run.length >= this.fenceTicks && WS.has(ch)) {
        this.inFence = false;
        this.fenceTicks = 0;
      }
      return this.prose(ch);
    }
    if (run.length >= 3) {
      // A code block opens; its opening line is held until its first character.
      this.fenceTicks = run.length;
      this.opener = run;
      this.mode = 'fenceInfo';
      return this.fenceInfo(ch);
    }
    this.text(run);
    this.prose(ch);
  }

  private fenceInfo(ch: string): void {
    this.opener += ch;
    if (ch === '\n') this.mode = 'fenceStart';
  }

  private fenceStart(ch: string): void {
    if (WS.has(ch)) {
      this.opener += ch;
      return;
    }
    if (ch === '{') {
      const opener = this.opener;
      this.opener = '';
      this.lineStart = true;
      return this.openObject(opener);
    }
    // The block does not open with an object: its opening line goes out as
    // written, and its body is read as text.
    this.releaseWs();
    this.emit(this.opener);
    this.opener = '';
    this.inFence = true;
    this.mode = 'prose';
    this.lineStart = true;
    this.prose(ch);
  }

  // ─── After an emptied object ───────────────────────────────────────

  /** The rest of an emptied object's line: only whitespace up to the newline ⇒ it goes whole. */
  private lineRest(ch: string): void {
    const o = this.emptied as ObjectScan;
    if (ch === '\n') {
      // Its line goes with it, newline and all.
      this.goesWhole(o);
      this.lineStart = true;
      return;
    }
    if (WS.has(ch)) {
      this.tail += ch;
      return;
    }
    // Something else shares its line: it stays, as `{}`.
    this.staysEmpty(o);
    this.step(ch);
  }

  /** The emptied object stood alone on its line: it goes, and its line with it. */
  private goesWhole(o: ObjectScan): void {
    this.emptied = undefined;
    this.tail = '';
    if (o.fence !== undefined) {
      // The block's opening line stays held — without the removed line's indentation.
      this.opener = o.fence.slice(0, o.fence.lastIndexOf('\n') + 1);
      this.mode = 'fenceAfter';
      this.lineStart = false;
      return;
    }
    this.dropRemovedIndent();
    if (o.initial) this.emptiedInitial = true;
    this.mode = 'prose';
    this.lineStart = false;
    this.blockRemoved();
  }

  /** The emptied object shares its line or sits in a list: it stays as `{}`. */
  private staysEmpty(o: ObjectScan): void {
    this.emptied = undefined;
    this.releaseWs();
    if (o.fence !== undefined) {
      this.emit(o.fence);
      this.inFence = true;
    }
    this.emit('{}' + this.tail);
    this.tail = '';
    this.mode = 'prose';
    this.lineStart = false;
    this.textStart = false;
    this.emptiedInitial = false;
  }

  private fenceAfter(ch: string): void {
    if (WS.has(ch)) {
      this.tail += ch;
      if (ch === '\n') this.lineStart = true;
      return;
    }
    if (ch === '`' && this.lineStart) {
      this.mode = 'fenceAfterTicks';
      this.ticks = ch;
      return;
    }
    if (ch === '{') {
      // Another object in the same block: the block's opening line stays held
      // with it, so a block of nothing but notes goes whole, fences and all.
      const fence = this.opener + this.tail;
      this.opener = '';
      this.tail = '';
      return this.openObject(fence);
    }
    this.keepFencedBlock('');
    this.prose(ch);
  }

  private fenceAfterTicks(ch: string): void {
    if (ch === '`') {
      this.ticks += ch;
      return;
    }
    if (this.ticks.length >= this.fenceTicks && WS.has(ch)) {
      this.ticks = '';
      this.removeFencedBlock();
      return this.prose(ch);
    }
    this.keepFencedBlock(this.takeTicks());
    this.prose(ch);
  }

  /** The code block held only the removed object: it goes, fences and all. */
  private removeFencedBlock(): void {
    this.dropRemovedIndent();
    this.opener = '';
    this.tail = '';
    this.inFence = false;
    this.fenceTicks = 0;
    this.mode = 'prose';
    this.lineStart = false;
    this.blockRemoved();
  }

  /** The code block holds more than the removed object's line: it stays, and is read on. */
  private keepFencedBlock(ticks: string): void {
    this.releaseWs();
    this.emit(this.opener + this.tail + ticks);
    this.opener = '';
    this.tail = '';
    this.inFence = true;
    this.mode = 'prose';
    this.lineStart = ticks === '' && this.lineStart;
    this.textStart = false;
  }

  // ─── Objects ───────────────────────────────────────────────────────

  private openObject(fence: string | undefined): void {
    this.obj = {
      index: this.objects++,
      initial: this.textStart && fence === undefined,
      ownLine: this.lineStart && this.listDepth === 0,
      fence,
      open: '{',
      openHeld: true,
      kept: 0,
      removed: 0,
      state: 'key?',
      sep: '',
      key: '',
      keyStr: { esc: 0 },
      reserved: false,
      raw: '',
      rawSep: 0,
      value: '',
      reader: undefined,
    };
    this.mode = 'object';
    this.textStart = false;
    this.lineStart = false;
    this.emptiedInitial = false;
  }

  /** `{`, and the code block's opening line before it, go out. */
  private releaseOpen(o: ObjectScan): void {
    if (!o.openHeld) return;
    this.releaseWs();
    if (o.fence !== undefined) {
      this.emit(o.fence);
      this.inFence = true;
    }
    this.emit(o.open);
    o.openHeld = false;
  }

  /** A character of the current member: shown when it is kept, held when it is reserved. */
  private member(o: ObjectScan, ch: string, value: boolean): void {
    if (!o.reserved) return this.emit(ch);
    o.raw += ch;
    if (value) o.value += ch;
  }

  private objectStep(ch: string): void {
    const o = this.obj as ObjectScan;
    switch (o.state) {
      case 'key?':
        if (WS.has(ch)) {
          if (o.kept + o.removed === 0) o.open += ch;
          else o.sep += ch;
          return;
        }
        if (ch === '"') {
          o.key = ch;
          o.keyStr.esc = 0;
          o.state = 'key';
          return;
        }
        if (ch === '}' && o.kept + o.removed === 0) {
          // `{}` — nothing to read, and nothing to remove.
          this.releaseOpen(o);
          this.emit(ch);
          return this.finishObject();
        }
        return this.abort(o, ch);
      case 'key': {
        const r = stringChar(o.keyStr, ch);
        if (r === 'bad') return this.abort(o, ch);
        o.key += ch;
        if (r === 'end') this.resolveKey(o);
        return;
      }
      case 'colon':
        if (WS.has(ch)) return this.member(o, ch, false);
        if (ch === ':') {
          this.member(o, ch, false);
          o.state = 'value?';
          return;
        }
        return this.abort(o, ch);
      case 'value?':
        if (WS.has(ch)) return this.member(o, ch, false);
        return this.startValue(o, ch);
      case 'value':
        return this.valueStep(o, ch);
      case 'after':
        if (WS.has(ch)) {
          o.sep += ch;
          return;
        }
        if (ch === ',') {
          o.sep += ch;
          o.state = 'key?';
          return;
        }
        if (ch === '}') return this.closeObject(o);
        return this.abort(o, ch);
    }
  }

  private resolveKey(o: ObjectScan): void {
    let name: unknown;
    try {
      name = JSON.parse(o.key);
    } catch {
      name = undefined;
    }
    if (name === this.key) {
      // The separator that joined it to the member before goes with it.
      o.reserved = true;
      o.removed += 1;
      o.raw = o.sep + o.key;
      o.rawSep = o.sep.length;
      o.value = '';
    } else {
      o.reserved = false;
      // The first member kept takes `{` and the whitespace after it; a
      // separator left behind by removed members before it goes.
      if (o.kept === 0) this.releaseOpen(o);
      else this.emit(o.sep);
      o.kept += 1;
      this.emit(o.key);
    }
    o.sep = '';
    o.key = '';
    o.state = 'colon';
  }

  private startValue(o: ObjectScan, ch: string): void {
    o.reader = new JsonValue();
    o.state = 'value';
    this.valueStep(o, ch);
  }

  /** A character of a member's value, read by JSON's grammar: the first one JSON cannot take gives the text back. */
  private valueStep(o: ObjectScan, ch: string): void {
    const r = (o.reader as JsonValue).step(ch);
    if (r === 'bad') return this.abort(o, ch);
    if (r === 'after') {
      this.endValue(o);
      return this.objectStep(ch);
    }
    this.member(o, ch, true);
    if (r === 'end') this.endValue(o);
  }

  private endValue(o: ObjectScan): void {
    if (o.reserved) {
      this.removed.push({ object: o.index, valueText: o.value, complete: true });
      o.reserved = false;
      o.raw = '';
      o.value = '';
    }
    o.reader = undefined;
    o.state = 'after';
  }

  private closeObject(o: ObjectScan): void {
    if (o.kept > 0) {
      this.emit(o.sep);
      this.emit('}');
      return this.finishObject();
    }
    // Every member was `_findings`: the object is empty now.
    this.emptyObjectEnded(o);
  }

  /** An object that held nothing but notes is over: whole if it stood on its own line, else `{}`. */
  private emptyObjectEnded(o: ObjectScan): void {
    this.obj = undefined;
    this.lineStart = false;
    this.tail = '';
    if (o.ownLine) {
      // Whether it goes whole depends on the rest of its line.
      this.emptied = o;
      this.mode = 'lineRest';
      return;
    }
    this.staysEmpty(o);
  }

  private finishObject(): void {
    this.obj = undefined;
    this.mode = 'prose';
    this.lineStart = false;
  }

  /** Not JSON after all: everything held goes out as written, and the character is read again. */
  private abort(o: ObjectScan, ch: string): void {
    // A `"` straight after a member is a missing comma before the next key,
    // not a missing closing brace: that object goes on, so it is given back.
    const missingComma = o.state === 'after' && ch === '"';
    if (o.kept === 0 && o.removed > 0 && !o.reserved && !missingComma) {
      // It held nothing but complete notes when the text stopped being JSON —
      // a model a closing brace short. The notes object ends here and goes as
      // an emptied one does; a trailing comma was its own, and the whitespace
      // after it (and a key it had begun) is read as the text that follows.
      const after = o.sep.slice(o.sep.lastIndexOf(',') + 1) + (o.state === 'key' ? o.key : '');
      this.emptyObjectEnded(o);
      for (const c of after) this.step(c);
      return this.step(ch);
    }
    this.releaseOpen(o);
    // A separator after removed members with nothing kept before it is theirs
    // (the rule `resolveKey` applies to the first kept member).
    if (o.kept > 0) this.emit(o.sep);
    if (o.state === 'key') this.emit(o.key);
    // A reserved member given back: with nothing kept before it, the
    // separator before it was a removed member's (the `resolveKey` rule).
    if (o.reserved) this.emit(o.kept > 0 ? o.raw : o.raw.slice(o.rawSep));
    this.finishObject();
    this.step(ch);
  }

  /** The text ended inside an object. */
  private endInObject(): void {
    const o = this.obj as ObjectScan;
    this.obj = undefined;
    this.mode = 'prose';
    if (o.reserved) {
      // Cut off inside `_findings`: its words stay hidden.
      this.removed.push({ object: o.index, valueText: o.value, complete: false });
    }
    if (o.kept === 0 && o.removed > 0 && o.state !== 'key') {
      // Nothing kept, something removed: as if it had closed there.
      if (!o.ownLine) return this.staysEmpty(o);
      this.goesWhole(o);
      if (o.fence !== undefined) this.removeFencedBlock();
      return;
    }
    // Everything else held goes out as written.
    this.releaseOpen(o);
    if (o.kept > 0) this.emit(o.sep);
    if (o.state === 'key') this.emit(o.key);
  }
}
