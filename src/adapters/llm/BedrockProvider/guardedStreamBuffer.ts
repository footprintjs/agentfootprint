/** Held SDK text/tool content. No tool fragments are parsed before response admission. */
import { ProviderGuardrailLimitError } from '../../../provider-contract/intervention.js';
import { ownData } from './guardrailRead.js';
import { parseToolArgs } from './response.js';

interface HeldTool {
  readonly id: string;
  readonly name: string;
  readonly fragments: string[];
  stopped: boolean;
}

export class GuardedStreamBuffer {
  private bytes = 0;
  private readonly text: string[] = [];
  private readonly tools = new Map<number, HeldTool>();
  valid = true;
  constructor(private readonly maximum: number) {}

  private field(value: unknown, name: string): unknown {
    const field = ownData(value, name);
    if (!field.valid) this.valid = false;
    return field.value;
  }

  private hold(value: string): void {
    // Primitive string iteration does not invoke a foreign iterator. Count
    // UTF-8 without allocating an encoded copy of an over-limit SDK string.
    for (const scalar of value) {
      const code = scalar.codePointAt(0) as number;
      this.bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      if (this.bytes > this.maximum) throw new ProviderGuardrailLimitError();
    }
  }

  acceptStart(value: unknown): void {
    const index = this.field(value, 'contentBlockIndex');
    const start = this.field(value, 'start');
    if (start === undefined) return;
    const tool = this.field(start, 'toolUse');
    if (tool === undefined) return;
    const id = this.field(tool, 'toolUseId');
    const name = this.field(tool, 'name');
    if (
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      this.tools.has(index)
    ) {
      this.valid = false;
      return;
    }
    this.hold(id);
    this.hold(name);
    this.tools.set(index, { id, name, fragments: [], stopped: false });
  }

  acceptDelta(value: unknown): void {
    const index = this.field(value, 'contentBlockIndex');
    const delta = this.field(value, 'delta');
    const text = this.field(delta, 'text');
    if (text !== undefined) {
      if (typeof text !== 'string') this.valid = false;
      else if (text.length > 0) {
        this.hold(text);
        this.text.push(text);
      }
    }
    const tool = this.field(delta, 'toolUse');
    if (tool === undefined) return;
    const fragment = this.field(tool, 'input');
    const open = typeof index === 'number' ? this.tools.get(index) : undefined;
    if (typeof fragment !== 'string' || open === undefined || open.stopped) {
      this.valid = false;
      return;
    }
    this.hold(fragment);
    // Empty fragments carry no bytes or data and require no retained slot.
    if (fragment.length > 0) open.fragments.push(fragment);
  }

  acceptStop(value: unknown): void {
    const index = this.field(value, 'contentBlockIndex');
    const open = typeof index === 'number' ? this.tools.get(index) : undefined;
    if (open !== undefined) {
      if (open.stopped) this.valid = false;
      open.stopped = true;
    }
  }

  hasCompleteContent(): boolean {
    return this.valid && [...this.tools.values()].every((tool) => tool.stopped);
  }

  content(): string {
    return this.text.join('');
  }
  chunks(): readonly string[] {
    return this.text;
  }
  toolCalls() {
    return [...this.tools].map(([index, tool]) => ({
      id: tool.id,
      name: tool.name,
      args: parseToolArgs(tool.fragments.join(''), tool.name, tool.id, index),
    }));
  }
}
