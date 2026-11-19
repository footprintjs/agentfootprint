const neutral = 'Request received.';
const messageFields = new Set(['role', 'content', 'toolCallId', 'toolName']);
const filingFact = /\b(?:filed|unfiled|recorded|unrecorded|completed|incomplete|succeeded|failed)\b/iu;
const deskChange = /\b(?:desk|catalog|card)\s+(?:(?:is|was|remains?)\s+)?(?:changed|unchanged|empty)\b|\b(?:nothing|no (?:desk )?change)\s+(?:changed|was made|was saved)\b/iu;
const deskCount = /\b(?:\d+|zero|one|seven|eight)\s*(?:of|out of|\/)\s*(?:1|8|one|eight)\b/iu;

function remember(ledger, event) {
  const id = event.payload.toolCallId;
  ledger.set(id, ledger.has(id) ? undefined : event);
}

// The native tool-end bracket precedes decoration. Repeated-call notices do
// not stamp toolChars, and the provider strips framework fields in any case.
// Join by the exact call to establish the tool's original text independently.
export function captureReplyBoundaries(agent, statusWords) {
  const starts = new Map();
  const ends = new Map();
  const repeats = new Map();
  const statuses = new Set(statusWords);
  const unsubscribers = [
    agent.on('agentfootprint.stream.tool_start', (event) => remember(starts, event)),
    agent.on('agentfootprint.stream.tool_end', (event) => remember(ends, event)),
    agent.on('agentfootprint.tools.repeated_call', (event) => remember(repeats, event)),
  ];
  return {
    stop() { for (const unsubscribe of unsubscribers) unsubscribe(); },
    inspect(reply, proposal) {
      if (Object.keys(reply).some((key) => !messageFields.has(key))) return { violation: 'provider-metadata' };
      const id = reply.toolCallId;
      const start = starts.get(id);
      const end = ends.get(id);
      if (proposal === undefined || reply.toolName !== proposal.name || start?.payload.toolName !== proposal.name ||
          start.payload.args?.target !== proposal.args.target || typeof start.meta?.runId !== 'string' ||
          start.meta.runId !== end?.meta?.runId || end.payload.entered !== true || end.payload.error === true) {
        return { violation: 'unverified-tool-boundary' };
      }
      const raw = Object.hasOwn(end.payload, 'modelResult') ? end.payload.modelResult : end.payload.result;
      if (raw !== neutral || typeof reply.content !== 'string' || !reply.content.startsWith(raw)) {
        return { violation: 'non-neutral-tool-text' };
      }
      const suffix = reply.content.slice(raw.length);
      if (!suffix) return {};
      const words = suffix.toLowerCase().match(/[a-z]+/gu) ?? [];
      if (statuses.size === 0 || words.some((word) => statuses.has(word)) ||
          filingFact.test(suffix) || deskChange.test(suffix) || deskCount.test(suffix)) {
        return { violation: 'framework-suffix-disclosed-outcome' };
      }
      const repeat = repeats.get(id);
      const identical = repeat?.meta?.runId === end.meta.runId && repeat.payload.toolName === proposal.name;
      return { notice: { toolCallId: id, kind: identical ? 'identical-call' : 'framework', suffix } };
    },
  };
}
