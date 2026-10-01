/**
 * bench/figures/replay.mjs — $0: the saved `before` answers of a figures-bench run, judged again
 * by the gate with `figures: true` (posture `assist`) over the SAME `before` view, against the
 * labeller. Measures the dial's own catch rate on real invented answers, apart from the tool fix.
 *
 *   npm run build && node bench/figures/replay.mjs bench/figures/runs/<run>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { CASES, FIXTURES, SYSTEM_PROMPT, TOOL_NAME, descriptionOf, viewOf } from './cases.mjs';
import { labelAnswer } from './labels.mjs';

const dir = process.argv[2];
const out = { inventing: 0, flagged: 0, clean: 0, flaggedClean: [], missed: [] };
for (const f of readdirSync(join(dir, 'raw'))) {
  const r = JSON.parse(gunzipSync(readFileSync(join(dir, 'raw', f))).toString('utf8'));
  if (r.arm !== 'before' || typeof r.answer !== 'string') continue;
  const c = CASES.find((x) => x.id === r.caseId);
  let step = 0;
  const provider = mock({
    respond: () =>
      step++ === 0 ? { toolCalls: [{ id: 'c1', name: TOOL_NAME, args: {} }] } : { content: r.answer },
  });
  const agent = Agent.create({ provider, model: 'mock', maxIterations: 3 })
    .system(SYSTEM_PROMPT)
    .tool(
      defineTool({
        name: TOOL_NAME,
        description: descriptionOf('before'),
        inputSchema: FIXTURES.inputSchema,
        execute: async () => viewOf(c, 'before'),
      }),
    )
    .namesAndNumbersFromEvidence({ posture: 'assist', figures: true })
    .build();
  const verdicts = [];
  agent.on('agentfootprint.agent.evidence_checked', (e) => verdicts.push(e.payload));
  const warn = console.warn;
  console.warn = () => {};
  await agent.run({ message: c.message });
  console.warn = warn;
  const last = verdicts[verdicts.length - 1];
  const flagged = last?.action === 'flagged';
  if (labelAnswer(r.answer, FIXTURES.record).invented.length > 0) {
    out.inventing += 1;
    if (flagged) out.flagged += 1;
    else out.missed.push(r.key);
  } else {
    out.clean += 1;
    if (flagged) out.flaggedClean.push({ key: r.key, unsupported: last.unsupported });
  }
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
