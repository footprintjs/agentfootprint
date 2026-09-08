/**
 * 24 — The receipt at the stop: what the model was actually handed.
 *
 * Stand on an `llm-turn` stop and ask the question this library exists for —
 * *what did the model read, right here?* — and until 9.88.0 the honest answer
 * was "most of it". The request a provider receives is assembled from committed
 * pieces and is itself never committed: the `call-llm` bundle holds the
 * response, not the ask. The pieces were all on the record; the rules that turn
 * them into a request lived inside the calling stage.
 *
 * Two things now stand at every turn, and one law binds them:
 *
 *   servedAt(snapshot, k)   the request, REBUILT from the committed pieces
 *   receiptAt(snapshot, k)  the FINGERPRINT the call itself left behind
 *
 *   hash(servedAt(k)) === receiptAt(k).hash
 *
 * When they agree, the record is complete: everything the model read is
 * derivable from the trace. When they disagree, something reached the model
 * that the run never wrote down.
 *
 * This example runs one agent whose turns are deliberately not identical — a
 * tool that stages data by reference, a spender tool that declares `wants` over
 * it, and an evidence gate that arms the staged-refs nudge — so the second
 * turn's request carries a `role: 'user'` line that is written to no history at
 * all. It is rebuilt here from committed state, and the law is checked against
 * the request the provider really received.
 *
 * It also prints what the record CANNOT prove: the sampling dials are the ones
 * the provider PORT was handed (a vendor may resolve its own), and a receipt
 * whose cache verdict is `'unchanged'` says the cache strategy changed nothing
 * — not that nothing downstream did.
 *
 * Offline + deterministic: a scripted provider, no API key, no network.
 *
 * Run:  npx tsx examples/observability/24-receipt-at-the-stop.ts
 */

import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  messageDigestInput,
  receiptAt,
  receiptHash,
  servedViews,
  RECEIPT_BOUNDARY,
  UNGAPPED_FIELDS,
  type LLMRequest,
  type LLMResponse,
} from '../../src/index.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/24-receipt-at-the-stop',
  title: 'The receipt at the stop — what the model was actually handed',
  group: 'observability',
  description:
    'servedAt(snapshot, epoch) rebuilds the request an LLM turn was served from the committed ' +
    'pieces alone; receiptAt(snapshot, epoch) reads the hashes-and-references record the call ' +
    'left behind at the same stop. The law hash(servedAt(k)) === receiptAt(k).hash turns "the ' +
    'record is complete" into something you can check — and servedAt(k).gaps names honestly ' +
    'what the log cannot rebuild.',
  defaultInput: 'stage the volume rows and total them',
  providerSlots: [],
  tags: ['observability', 'time-travel', 'receipt', 'served', 'audit', 'artifacts'],
};

/** Enough rows to cross the placement threshold, so the result is STAGED by
 *  reference — a ticket in the conversation rather than a wall of numbers. */
const ROWS = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ volume: `vol-${i}`, gb: 18 })));

const exportRows = defineTool({
  name: 'export_rows',
  description: 'Export the volume rows.',
  resultKind: 'dataset/rows',
  execute: () => ROWS,
});

/** The spender: it DECLARES that it takes refs of the staged kind. That
 *  declaration is what arms the nudge — never the tool's name. */
const compute = defineTool<{ dataset: string }, string>({
  name: 'compute',
  description: 'Compute over a staged dataset.',
  inputSchema: { type: 'object', properties: { dataset: { type: 'string' } } },
  wants: { dataset: 'dataset/rows' },
  execute: () => 'total: 3,600 GB',
});

/**
 * Break text at a width, on WORD boundaries.
 *
 * The first cut of this printed `reason.split('.')[0]`, which stops at the
 * first period in the string — and the reason it was printing says "measured on
 * 9.88.0", so a reader was handed "measured on 9." A wrap that cuts inside a
 * version number is worse than a long line: it reads as a complete sentence.
 */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** A provider that answers from a script and keeps every request verbatim —
 *  the WIRE witness the law is checked against. */
function scriptedProvider(script: readonly LLMResponse[]) {
  const wire: LLMRequest[] = [];
  let i = 0;
  return {
    wire,
    provider: {
      name: 'scripted',
      complete: async (request: LLMRequest): Promise<LLMResponse> => {
        wire.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
        return script[Math.min(i++, script.length - 1)]!;
      },
    },
  };
}

export async function run(): Promise<void> {
  const { provider, wire } = scriptedProvider([
    {
      content: '',
      toolCalls: [{ id: 'c1', name: 'export_rows', args: {} }],
      usage: { input: 1, output: 1 },
      stopReason: 'tool_use',
    },
    {
      content: '',
      toolCalls: [{ id: 'c2', name: 'compute', args: { dataset: 'ref' } }],
      usage: { input: 1, output: 1 },
      stopReason: 'tool_use',
    },
    {
      content: 'The compute tool has the total for the staged rows.',
      toolCalls: [],
      usage: { input: 1, output: 1 },
      stopReason: 'end_turn',
    },
  ]);

  const agent = Agent.create({
    provider: provider as never,
    model: 'mock',
    maxIterations: 6,
    artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 2000 } },
  })
    .system('You are a storage engineer.')
    .tool(exportRows)
    .tool(compute)
    .namesAndNumbersFromEvidence({ nudge: true })
    .build();

  const answer = await agent.run({ message: meta.defaultInput! });
  const snapshot = agent.getSnapshot()!;

  console.log(`\nThe answer: ${answer}\n`);

  // ── every epoch, rebuilt and checked ────────────────────────────────
  for (const view of servedViews(snapshot)) {
    const receipt = receiptAt(snapshot, view.epoch)!;
    const hash = (text: string) => receiptHash(receipt.basis.runId, text);

    console.log(`── epoch ${view.epoch} — ${view.callRuntimeStageId} ──────────────`);
    // WHICH model saw this — on the view too, read off the receipt's basis, so
    // a renderer that only holds a `ServedView` can still say whose context
    // this was.
    console.log(`   model         ${view.basis!.model} via ${view.basis!.provider}`);
    // The dials it went out on. The same context at another temperature is a
    // different call, and "why did this turn ramble?" is unanswerable from a
    // record that kept the prompt and dropped the knob.
    console.log(
      `   params        ${Object.entries(receipt.params)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ') || '(none set — the library sent no dials)'}`,
    );
    console.log(
      `   system        ${receipt.system.chars} chars in ${receipt.system.pieces.length} piece(s):` +
        ` ${view.system.pieces.map((p) => p.source).join(' + ')}`,
    );
    console.log(
      `   messages      ${receipt.messages.count} on the request` +
        ` (${view.messages.asSent.length} from history` +
        `${view.messages.requestOnly.length > 0 ? `, ${view.messages.requestOnly.length} request-only` : ''})`,
    );
    console.log(`   tools         ${view.tools.names.join(', ') || '(none)'}`);

    // The one model-facing line that is written to NO history. It exists for a
    // single request and is recomposed each iteration — so the only way a
    // reader ever sees it again is a rebuild from the pieces it was made of.
    for (const line of view.messages.requestOnly) {
      console.log(`   request-only  [${line.reason}] ${line.text}`);
    }

    // ── THE LAW ───────────────────────────────────────────────────────
    const systemHolds = hash(view.system.text) === receipt.system.hash;
    const messagesHold = view.messages.asSent.every(
      (message, i) => receipt.messages.entries[i]?.hash === hash(messageDigestInput(message)),
    );
    // …and the same receipt describes what the provider REALLY got.
    const wireHolds = hash(wire[view.epoch - 1]!.systemPrompt ?? '') === receipt.system.hash;
    console.log(
      `   law           rebuild ${systemHolds && messagesHold ? '✓' : '✗'}` +
        `   wire ${wireHolds ? '✓' : '✗'}`,
    );

    // ── and what this view honestly cannot prove ─────────────────────
    // Never empty. A rebuild that quietly omits a piece looks exactly like one
    // that proved the piece absent; the gap is what keeps the two apart.
    for (const gap of view.gaps) {
      // The CAUSE, where the read that raised the gap could establish one. It
      // is a field and not a clause in `why` because a frozen sentence cannot
      // know what happened at the site it is printed beside — see
      // `ServedGapCause`.
      const cause = gap.cause !== undefined ? ` (${gap.cause})` : '';
      console.log(`   gap           ${gap.gap}${cause} → ${gap.fields.join(', ')}`);
    }
    console.log('');
  }

  // ── the OTHER half of the account ────────────────────────────────────
  // A field with no gap beside it is not an oversight: `UNGAPPED_FIELDS` says
  // which fields need none and why, in one sentence each. Between the two,
  // every field of a receipt and a view is accounted for — and a walk
  // (test/lib/time-travel/gap-catalogue-walk.test.ts) is what keeps that true
  // as fields are added, rather than somebody re-reading the list.
  console.log('Fields no gap explains, and why none is needed:');
  for (const [field, reason] of Object.entries(UNGAPPED_FIELDS)) {
    for (const [i, line] of wrap(reason, 74).entries()) {
      console.log(`   ${i === 0 ? field.padEnd(20) : ' '.repeat(20)}${line}`);
    }
  }
  console.log('');

  // ── the boundary, printed where a reader meets the record ───────────
  // A receipt is minted at the provider PORT. Everything on it is true there
  // and nowhere past it — which is exactly the sentence a reader needs before
  // treating `cache.transform: 'unchanged'` as proof about the wire.
  console.log(`Boundary: ${RECEIPT_BOUNDARY}\n`);

  console.log(
    'Takeaway: the request itself is never committed — only its pieces are. `servedAt` puts it\n' +
      'back together with the same functions the call used, `receiptAt` says what the call really\n' +
      'sent, and the gaps name what neither can prove. A receipt carries hashes and names, never\n' +
      'bytes: run-salted, so the same sentence in two runs has two fingerprints and a digest\n' +
      'cannot be matched across recordings.\n' +
      '\n' +
      'What a recording contains, though, is the plaintext. An agent run is not redacted —\n' +
      'Agent.create() has no redaction door — so the system prompt above is in the commit log\n' +
      'verbatim, and the salt protects the fingerprints and only the fingerprints. Redaction here\n' +
      "is executor-level: flowchartAsTool({ redact }) scrubs an INNER run's commit log at write\n" +
      'time. Treat a recording accordingly before you pass one on.\n',
  );
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
