/**
 * 01 — A folder of documents becomes an answering agent.
 *
 * The whole R3 story in one file, against three REAL documents committed next
 * to it: two Markdown files and a two-page PDF.
 *
 *   run 1  full index      → embedded N, skipped 0
 *   run 2  nothing changed → embedded 0, skipped N       ← the point of a file
 *   run 3  edit one, delete one → embedded few, removed the gone ones
 *
 * Then the agent answers, and every passage it read can be located: which
 * chunk, which document, which page, what it scored, and what was rejected
 * just below it.
 *
 * The index lives in a temp directory so the example is repeatable; in a real
 * application it is a path you keep, which is what makes the second run cost
 * nothing.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Agent, defineRAG, type LLMProvider } from '../../src/index.js';
import { indexFolder } from '../../src/doors/rag.js';
import { InMemoryStore, mockEmbedder } from '../../src/doors/memory.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'rag/01-folder-to-agent',
  title: 'A folder of documents becomes an answering agent',
  group: 'rag',
  description:
    'indexFolder over three real documents (two Markdown, one 2-page PDF), ' +
    'run three times to show incremental re-indexing, then an agent answers ' +
    'with the passage, the document, the page and the score.',
  defaultInput: 'How long do refunds take?',
  providerSlots: ['default'],
  tags: ['rag', 'retrieval', 'indexing', 'provenance'],
};

const HERE = dirname(fileURLToPath(import.meta.url));

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // Work on a COPY, so the committed corpus is never edited by the example.
  const work = mkdtempSync(join(tmpdir(), 'af-rag-example-'));
  const docs = join(work, 'docs');
  cpSync(join(HERE, 'docs'), docs, { recursive: true });
  const lines: string[] = [];

  try {
    const store = new InMemoryStore();
    const embedder = mockEmbedder();

    // #region index
    const index = () => indexFolder(docs, { to: store, embedder, embedderId: embedder.id });

    // RUN 1 — everything is new.
    const first = await index();
    lines.push(summarize('run 1  (first index)   ', first));

    // RUN 2 — nothing changed. Nothing is embedded again.
    const second = await index();
    lines.push(summarize('run 2  (no changes)    ', second));

    // RUN 3 — edit one document, delete another.
    const policy = join(docs, 'refund-policy.md');
    writeFileSync(
      policy,
      readFileSync(policy, 'utf8').replace('within 3 business days', 'within 5 business days'),
    );
    unlinkSync(join(docs, 'pricing.md'));
    const third = await index();
    lines.push(summarize('run 3  (edit + delete) ', third));
    // #endregion index

    // #region retrieve
    const agent = Agent.create({
      provider: provider ?? mock({ reply: 'Refunds are processed within 5 business days.' }),
      model: 'mock',
      maxIterations: 1,
    })
      .system('Answer from the retrieved passages. Cite the source id you used.')
      .rag(
        defineRAG({
          id: 'product-docs',
          store,
          embedder,
          embedderId: embedder.id,
          topK: 3,
          threshold: -1, // mockEmbedder scores low; a real embedder uses ~0.5
        }),
      )
      .build();

    agent.on('agentfootprint.memory.retrieved', (e) => {
      lines.push('\nwhy this passage');
      for (const c of e.payload.candidates ?? []) {
        const where = [c.docUri && shortName(c.docUri), c.page && `p${c.page}`, c.heading]
          .filter(Boolean)
          .join(', ');
        lines.push(
          `  ${c.admitted ? '✓' : '✗'} ${shortName(c.id).padEnd(28)} ` +
            `${c.score.toFixed(2)}  ${where}${c.reason ? `  ${c.reason}` : ''}`,
        );
      }
    });

    const answer = await agent.run({ message: input });
    // #endregion retrieve
    if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');

    lines.push(`\nanswer: ${answer}`);
    return lines.join('\n');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function summarize(label: string, r: { discovered: number; loaded: number; chunks: number; embedded: number; skipped: number; removed: number }): string {
  return (
    `${label}discovered ${r.discovered} · loaded ${r.loaded} · chunks ${r.chunks} · ` +
    `embedded ${r.embedded} · skipped ${r.skipped} · removed ${r.removed}`
  );
}

/** Trim the temp-directory prefix so the output is readable and stable. */
function shortName(uri: string): string {
  const at = uri.lastIndexOf('/');
  return at === -1 ? uri : uri.slice(at + 1);
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
