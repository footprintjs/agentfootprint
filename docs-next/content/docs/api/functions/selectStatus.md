---
title: selectStatus
---

# Function: selectStatus()

> **selectStatus**(`events`): [`StatusState`](/docs/api/interfaces/StatusState) \| `null`

Defined in: [src/recorders/observability/status/statusTemplates.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/status/statusTemplates.ts#L111)

Derive the current thinking state from the event log.

Single forward walk that tracks "active" state for each domain:
  • pause       — set on pause.request, cleared on pause.resume
  • tool        — set on tool.start, cleared on matching tool.end
                  (matched by `toolCallId` for parallel-tool safety)
  • llm         — set on llm.start, cleared on llm.end

Priority order (highest first):

  1. ACTIVE PAUSE wins. When the agent is waiting on the human,
     that's what the chat should show — not the underlying tool
     that triggered the pause.
  2. ACTIVE TOOL — the LLM said "use a tool" and the tool is
     running. Show "Working on `<toolName>`…".
  3. ACTIVE LLM — call in flight. Show streaming tokens if any
     arrived, otherwise "Thinking…".
  4. Otherwise null (bubble hidden).

Pure projection. Forward walk is O(n); a closing event correctly
cancels its matching opener so a completed tool.start/tool.end
pair leaves the state quiescent.

## Parameters

### events

readonly [`AgentfootprintEvent`](/docs/api/type-aliases/AgentfootprintEvent)[]

## Returns

[`StatusState`](/docs/api/interfaces/StatusState) \| `null`
