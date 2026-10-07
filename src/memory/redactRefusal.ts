/**
 * The memory `redact` refusal — one sentence, said in every place the option
 * could be declared.
 *
 * WHY THIS EXISTS. `defineMemory({ redact })` accepted a
 * `MemoryRedactionPolicy` (`{ patterns, replacement }`), typed "Reserved for
 * a future release", stored it on the returned `MemoryDefinition`, and
 * NOTHING ever read it. Every store wrote what it was handed; a reader who
 * set the option was told a protection the run never applied.
 *
 * WHY IT IS REFUSED RATHER THAN IMPLEMENTED. Three reasons, in order of how
 * much each one decides.
 *
 *   1. A memory is WORKING STATE, not a record. What a store holds is what a
 *      later run recalls and computes on. footprintjs's redaction law — the
 *      one this library applies through `Agent.create({ redact })` — covers
 *      everything retained or served as a RECORD and never the state a run
 *      computes on, nor the checkpoint it resumes from. A scrubbed memory
 *      would change what the agent KNOWS: the harness side of the line
 *      `docs/design/local-observability-and-pii.md` draws, not the record's.
 *   2. The reserved shape matched CONTENT (regexes over stored text). The one
 *      rule this library redacts by selects by NAME, never by content — a
 *      second, content-matching redactor here would be a second owner of
 *      "what is secret", which the library does not have.
 *   3. By name it would do almost nothing a deployment wants: a memory entry's
 *      names are structural (`role`, `content`, `value`); naming `content`
 *      would blank every recalled turn, naming anything else would mask
 *      nothing in the text people actually wrote.
 *
 * WHAT DOES THE JOB. The agent's `redact` keeps named values out of the
 * RECORD of every memory stage — its commits, its `memory.*` events, the
 * narrative — like any other stage. Keeping personal data out of the STORE is
 * a decision about what the agent remembers: do not write it (`readOnly: true`
 * on the memory, or no memory at all), or scrub it yourself before it reaches
 * the store (a `MemoryStore` wrapper whose `put` does it).
 *
 * A throw where there was a silent lie is a fix, not a break: nothing that
 * worked stops working, and something that never worked stops pretending.
 */

/**
 * The refusal text, addressed from `site` (e.g. `defineMemory('chat')`).
 */
export function memoryRedactRefusal(site: string): string {
  return (
    `${site}: \`redact\` is not implemented, and never was — no memory store ever scrubbed ` +
    `anything because of it. It is refused rather than built: a memory is the agent's ` +
    `working state (what a later run recalls), and redaction in this library governs the ` +
    `RECORD, never the state a run computes on. Keep personal data out of the record with ` +
    `\`Agent.create({ redact })\` — it covers the memory stages' commits and events too. ` +
    `Keep it out of the store by not writing it (\`readOnly: true\`, or no memory), or by ` +
    `scrubbing it yourself before \`put\` (a MemoryStore wrapper). Drop the option.`
  );
}

/**
 * Throw the refusal when a caller passed `redact`. Presence, not value — an
 * empty `redact: {}` was just as unread as a full one, and letting the
 * "harmless" one through would teach that the option works.
 */
export function refuseMemoryRedact(options: object, site: string): void {
  if ('redact' in options) throw new Error(memoryRedactRefusal(site));
}
