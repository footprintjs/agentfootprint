---
name: Status subpath — selectThinkingState + renderThinkingLine + templates
group: features
guide: ../../README.md#features
defaultInput: check the weather in Paris
---

# Status subpath — `agentfootprint/status`

Two ways to drive a "what's the agent doing right now?" line:

| Surface | When to use |
|---|---|
| `agent.enable.thinking({ onStatus })` | One callback, opinionated formatter, zero subscriptions to wire. Use for **chat widgets** that just want strings to render. See [`04-observability.md`](./04-observability.md). |
| `agentfootprint/status` (this example) | Lower-level state machine + templates + renderer. Use when you need **full control** — custom formatting, per-tool overrides, locale switching, custom UI shapes. |

This example shows the lower-level surface. It's what `agentfootprint-lens` and consumers like `neo-mds-triage` use to drive their custom chat-bubble status feeds.

## The state machine

`selectThinkingState(events)` walks the typed event log forward and returns the **current** state (or `null` when the bubble should hide):

```
              ┌──────────┐  llm.start, no tools yet
          ────┤  idle    ├────────► "Thinking…"
              └──────────┘

              ┌──────────┐  stream.token chunks accumulate
          ────┤streaming ├────────► "{{partial}}"
              └──────────┘

              ┌──────────┐  tool.start, no tool.end yet
          ────┤   tool   ├────────► "Working on `weather`…"
              └──────────┘           (or `tool.<toolName>` override)

              ┌──────────┐  pause.request, no resume yet
          ────┤  paused  ├────────► "Waiting on you: …"
              └──────────┘

              (null)        run done / between calls   → bubble hidden
```

Priority resolution: pause > tool > LLM. Whichever is active when you call `selectThinkingState` wins.

## The renderer

`renderThinkingLine(state, ctx, templates?)` resolves the template + substitutes vars:

```ts
import {
  selectThinkingState,
  renderThinkingLine,
  defaultThinkingTemplates,
  type ThinkingTemplates,
} from 'agentfootprint/status';

const myTemplates: ThinkingTemplates = {
  ...defaultThinkingTemplates,
  idle: 'Bot is thinking…',
  'tool.weather': 'Looking up the weather…', // per-tool override
  paused: 'Waiting on you: {{question}}',
};

const state = selectThinkingState(events);
const line = renderThinkingLine(state, { appName: 'Bot' }, myTemplates);
// → 'Bot is thinking…'   (when LLM is processing without streamed tokens yet)
// → 'Looking up the weather…'   (when the `weather` tool is active)
```

## Built-in template vars

Filled by `selectThinkingState`:

| Var | Filled when |
|---|---|
| `{{appName}}` | Always — passed via `ThinkingContext` at render time |
| `{{toolName}}` | `state === 'tool'` |
| `{{toolCallId}}` | `state === 'tool'` (when the event carried an id) |
| `{{partial}}` | `state === 'streaming'` (accumulated tokens since `llm.start`) |
| `{{question}}` | `state === 'paused'` (pause reason) |

## Arg-aware templates (when you need `{{switchName}}`, `{{interface}}`, etc.)

`selectThinkingState` does NOT surface tool args today. For arg-aware status lines (e.g., `"Reading errors on {{switchName}} {{interface}}…"`), consumers walk the raw event stream and substitute from `event.payload.args` directly. See `neo-mds-triage/web/src/components/ChatFeed.tsx::renderToolLabel` for the reference pattern: per-tool template lookup, then `for (const [k, v] of Object.entries(args))` to pull string args into the substitution map.

## When to pick `'*'` vs domain wildcard

This example uses `'*'` to subscribe to every event. Cheaper alternatives when you only care about specific domains:

```ts
agent.on('agentfootprint.stream.*', listener); // LLM/tool stream events only
agent.on('agentfootprint.agent.*', listener);  // turn / iteration / route events
```

⚠️ `'agentfootprint.*'` (just the namespace, no domain) is **NOT** a valid pattern — silently matches nothing. Use `'*'` or `'agentfootprint.<domain>.*'`.

## Run

```sh
TSX_TSCONFIG_PATH=examples/runtime.tsconfig.json npx tsx examples/features/06-status-subpath.ts
```

Expected output:

```
  💬 Bot is thinking…
  💬 Looking up the weather…
  💬 Bot is thinking…
  💬 Got
  💬 Got it
  💬 Got it — Paris: 72°F, sunny
```

(Streaming chunks appear as the bot writes the final answer.)
