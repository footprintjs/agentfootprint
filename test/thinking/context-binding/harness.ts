/**
 * A scripted Anthropic SDK client and an INDEPENDENT prefix comparator, for
 * the context-binding tests.
 *
 * The comparator is the oracle: it reads only the request bodies the scripted
 * client received, never the library's guard or its check. For each pair of
 * bodies it names what differs in the parts a bound model compares — the
 * `system` text (cache marks stripped), the `tools` as a name-keyed set, and
 * the leading messages (thinking blocks and cache marks stripped).
 */

export type Block = Record<string, unknown> & { type: string };
export interface Body {
  system?: string | Block[];
  messages: { role: string; content: string | Block[] }[];
  tools?: readonly (Record<string, unknown> & { name: string })[];
}

/** One scripted reply. `thinking: false` returns no thinking block (the witness run). */
export interface Step {
  readonly thinking?: boolean;
  readonly text?: string;
  readonly tool?: string;
  readonly input?: Readonly<Record<string, unknown>>;
}

export function scriptedClient(model: string, bodies: Body[], script: readonly Step[]) {
  let n = 0;
  const reply = (params: Body) => {
    bodies.push(JSON.parse(JSON.stringify(params)) as Body);
    const step = script[Math.min(n, script.length - 1)];
    n += 1;
    const content: Block[] = [];
    if (step.thinking !== false)
      content.push({ type: 'thinking', thinking: `reasoning ${n}`, signature: `sig-${n}` });
    if (step.text !== undefined) content.push({ type: 'text', text: step.text });
    if (step.tool !== undefined)
      content.push({
        type: 'tool_use',
        id: `toolu_${n}`,
        name: step.tool,
        input: step.input ?? {},
      });
    return {
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason: step.tool !== undefined ? 'tool_use' : 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  };
  return {
    messages: {
      create: async (params: Body) => reply(params),
      stream: (params: Body) => {
        const message = reply(params);
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'message_start',
              message: { ...message, content: [], stop_reason: null },
            };
            for (const [index, block] of message.content.entries()) {
              yield {
                type: 'content_block_start',
                index,
                content_block: block.type === 'tool_use' ? { ...block, input: {} } : block,
              };
              if (block.type === 'tool_use')
                yield {
                  type: 'content_block_delta',
                  index,
                  delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
                };
              if (block.type === 'text')
                yield {
                  type: 'content_block_delta',
                  index,
                  delta: { type: 'text_delta', text: block.text },
                };
              yield { type: 'content_block_stop', index };
            }
            yield {
              type: 'message_delta',
              delta: { stop_reason: message.stop_reason },
              usage: message.usage,
            };
            yield { type: 'message_stop' };
          },
          finalMessage: async () => message,
        };
      },
    },
  };
}

// ─── the oracle ─────────────────────────────────────────────────────

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object).sort())
    if (key !== 'cache_control') out[key] = strip((value as Record<string, unknown>)[key]);
  return out;
}

function systemText(system: Body['system']): string {
  if (system === undefined) return '';
  if (typeof system === 'string') return system;
  return system
    .map((b) => (typeof b.text === 'string' ? b.text : JSON.stringify(strip(b))))
    .join('');
}

function message(m: Body['messages'][number]): string {
  // A string turn and a one-text-block turn are the same message (a cache mark makes one the other).
  if (typeof m.content === 'string')
    return JSON.stringify([m.role, strip([{ type: 'text', text: m.content }])]);
  const kept = m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
  return JSON.stringify([m.role, strip(kept)]);
}

export interface PrefixDiff {
  readonly system: boolean;
  readonly toolsAdded: readonly string[];
  readonly toolsRemoved: readonly string[];
  readonly toolsChanged: readonly string[];
  /** Positions among `before`'s messages that are missing or differ in `after`. */
  readonly messages: readonly number[];
}

/** What `after` changes in the prefix `before` was sent with. */
export function prefixDiff(before: Body, after: Body): PrefixDiff {
  const tools = (b: Body) =>
    new Map((b.tools ?? []).map((t) => [t.name, JSON.stringify(strip(t))]));
  const a = tools(before);
  const b = tools(after);
  const messages: number[] = [];
  before.messages.forEach((m, i) => {
    const later = after.messages[i];
    if (later === undefined || message(later) !== message(m)) messages.push(i);
  });
  return {
    system: systemText(before.system) !== systemText(after.system),
    toolsAdded: [...b.keys()].filter((name) => !a.has(name)),
    toolsRemoved: [...a.keys()].filter((name) => !b.has(name)),
    toolsChanged: [...a.keys()].filter((name) => b.has(name) && a.get(name) !== b.get(name)),
    messages,
  };
}

export function unchanged(diff: PrefixDiff): boolean {
  return (
    !diff.system &&
    diff.toolsAdded.length === 0 &&
    diff.toolsRemoved.length === 0 &&
    diff.toolsChanged.length === 0 &&
    diff.messages.length === 0
  );
}
