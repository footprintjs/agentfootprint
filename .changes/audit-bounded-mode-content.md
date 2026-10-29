---
type: changed
---
**The bounded audit export now bounds every sentence and value a run composes, on every event — not only prompts, answers, tool data and error messages.** `auditExport()`'s default `payloadMode: 'bounded'` promises that a chained record keeps a run's structure and never its content. It kept that promise for prompts, answers, tool arguments and results, previews and error messages. Other content it carried as written, sanitized and capped at 256 characters:

- a typed answer's limits and negatives on `turn_end` (`answerCoverage`, `answerNegatives`);
- a tool's absence, coverage and described-result words and data;
- the evidence gate's values, an external ground's value, the message text a routing match quotes, and a validation issue's quoted value;
- parser and fallback messages and previews, a fallback's or credential failure's message, a fail-fast reason, a tool effect's reason and a pause's reason;
- a tool's progress payload, a check-in's evidence pack, a person's note, and a middleware's reason or question;
- the model's own words, a router's own reason, a permission check's rationale and the text it told the model;
- the opt-in assembled system prompt, a retrieved passage's heading, an integrity finding's witnessed values and message, and an artifact's label and refusal detail.

Each is now the same marker the other bounded fields use: `'[N chars]'`, `'[type: …]'`, or `'[keys: …]'` for a free-form record. Every event keeps its structure: lists and their lengths, ids, tool, skill and argument names, kinds, codes, verdicts and counts. A field a shape does not name, or a value that is not the declared shape, is a marker too.

The module documentation now says exactly what a bounded record still carries, by contract:

- each record's `meta`: run ids and, when the caller named them, session, principal and tenant;
- `decide()` evidence as the engine summarized it;
- a policy's telemetry `reason` tag, and the reason word an app attaches to lifecycle events it emits itself;
- a `tryInsteadTool` name, once the strategy has seen that tool run.

`payloadMode: 'verbatim'` is unchanged, and so is every other exporter.

Migration: a consumer that read any of these sentences or values out of a bounded bundle now finds a marker in its place. Read them from a `payloadMode: 'verbatim'` bundle kept in an access-controlled store, or in process from the agent's accessors (`agent.answerCoverage()`, `agent.answerNegatives()`) and events. Bundles written before the change still verify; only new records differ.
