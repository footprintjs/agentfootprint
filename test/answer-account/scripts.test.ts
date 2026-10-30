/**
 * The answer account's script lines (design docs/design/2026-10-script-artifact.md
 * § 6.2): the "How sure" row gains one line per script the answer SHOWED and
 * one per script the library ATTACHED — F1 (the match, the library's) and F2
 * (the outcome, the tool's runner's) in one sentence vouched by the weaker,
 * the library; F3 stays the evidence lines'. The attached block is the
 * library's appended section, found by rebuilding it from the record, never
 * the model's words. An exit number is printed only from a recorded exit code;
 * the program itself is never printed or shown.
 *
 * INTEGRATION (real runs on the mock, recorded) — every account's pointers
 * resolve (P1) and print no refused leaf (P7).
 */

import { describe, expect, it } from 'vitest';

import { Agent, codeRunnerTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../src/observe.js';
import { showLeaves } from '../../src/answer-account/shown.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import type { CodeResult } from '../../src/provider-contract/types.js';
import type { RedactionPolicy } from 'footprintjs';
import { conversationRedaction } from '../../src/doors/security.js';
import { assertP1, assertP7, linesOf } from './helpers.js';

const PROGRAM = 'print("SECRET-PROGRAM-TEXT", 41 + 1)';

function runner(result: CodeResult) {
  return {
    id: 'answering',
    start: () =>
      Promise.resolve({
        id: 's1',
        execute: () => Promise.resolve(result),
        stop: () => Promise.resolve(),
      }),
  };
}

async function accountOf(o: {
  readonly result: CodeResult;
  readonly answer: string;
  readonly travel?: { maxBytes?: number };
  readonly redact?: RedactionPolicy;
}) {
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'run_code', args: { code: PROGRAM } }] },
        { content: o.answer },
      ] as never,
    }),
    model: 'mock',
    ...(o.redact !== undefined && { redact: o.redact }),
  })
    .tool(codeRunnerTool({ runner: runner(o.result) }))
    .namesAndNumbersFromEvidence({ posture: 'assist', code: 'match' })
    .scriptTravelsWithTheAnswer(o.travel)
    .answerLayer()
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message: 'compute' });
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  recorder.stop();
  const account = accountForAnswer(recording);
  return { account, recording, texts: linesOf(account).map((s) => s.text) };
}

const fenced = (program: string) => `\`\`\`python\n${program}\n\`\`\``;

describe('INTEGRATION — one line per shown and per attached script', () => {
  it('a matched block and the attachment: both said, labelled from the record, the program never printed', async () => {
    const { account, recording, texts } = await accountOf({
      result: { ok: true, exitCode: 0, stdout: '42', stderr: '' },
      answer: `It printed 42.\n\n${fenced(PROGRAM)}`,
    });
    expect(texts).toContain(
      'The script shown is the one submitted to run_code on call c1; it completed, exit 0.',
    );
    expect(texts).toContain(
      "The script under the answer was attached by the library from the record of run_code's call c1 (completed, exit 0; 36 bytes).",
    );
    // The attached block is the LIBRARY's appended section — never the model's words.
    expect(account.answer.value).toBe(`It printed 42.\n\n${fenced(PROGRAM)}`);
    expect(account.facts.limitsBlock).toMatchObject({ source: 'library', status: 'recorded' });
    // The program is never printed in a line, and no row or attachment `text` is ever shown
    // (the answer itself — which carries it — is shown as the answer, as it always was).
    expect(JSON.stringify(linesOf(account))).not.toContain('SECRET-PROGRAM-TEXT');
    const shown = Object.keys(showLeaves(account, recording));
    expect(shown.filter((key) => /\/text$/.test(key))).toEqual([]);
    assertP1(account, recording);
    assertP7(account, recording);
  });

  it('a service error with no exit code: "its outcome is unknown: the service reported an error"', async () => {
    const { account, recording, texts } = await accountOf({
      result: { ok: false, serviceError: true, stdout: '', stderr: 'service refused execution' },
      answer: `It could not run.\n\n${fenced(PROGRAM)}`,
    });
    expect(texts).toContain(
      'The script shown is the one submitted to run_code on call c1; its outcome is unknown: the service reported an error, and whether the program ran is not known.',
    );
    expect(texts.join('\n')).not.toMatch(/exit \d/);
    assertP1(account, recording);
    assertP7(account, recording);
  });

  it('a runner verdict with no exit code: no exit number anywhere', async () => {
    const { account, recording, texts } = await accountOf({
      result: { ok: true, stdout: '42', stderr: '' },
      answer: `It printed 42.\n\n${fenced(PROGRAM)}`,
    });
    expect(texts).toContain(
      'The script shown is the one submitted to run_code on call c1; the runner reported success; no exit code was recorded.',
    );
    expect(texts.join('\n')).not.toMatch(/exit 0/);
    assertP1(account, recording);
    assertP7(account, recording);
  });

  it('an UNMATCHED block: the line, and the standing’s own reason', async () => {
    const { account, recording, texts } = await accountOf({
      result: { ok: true, exitCode: 0, stdout: '42', stderr: '' },
      answer: `It printed 42.\n\n${fenced('print(41 + 1)')}`,
    });
    expect(texts).toContain(
      'A script shown matches no submission of this turn on the record; its contents were checked as prose.',
    );
    expect(texts).toContain(
      'A script shown in the answer matches no submission of this turn on the record.',
    );
    expect(account.facts.standing.value).toBe('not-sure');
    assertP1(account, recording);
    assertP7(account, recording);
  });

  it('a CUT attachment says it is not the whole program', async () => {
    const { account, recording, texts } = await accountOf({
      result: { ok: true, exitCode: 0, stdout: '42', stderr: '' },
      answer: 'It printed 42.',
      travel: { maxBytes: 10 },
    });
    expect(texts).toContain(
      "The script under the answer was attached by the library from the record of run_code's call c1 (completed, exit 0; 36 bytes).",
    );
    expect(texts).toContain(
      'The attached script of call c1 shows 10 of its 36 bytes — not the whole program.',
    );
    assertP1(account, recording);
    assertP7(account, recording);
  });

  it('a record served under a redaction policy: the account refuses to tell — no placeholder is read as a call or a tool', async () => {
    // Under any policy the value-kind rule serves every string that is not a
    // library word as the placeholder, at every depth — `turn_end.scripts`
    // and `evidence_checked.scripts` included. The account never reaches a
    // script line there: its readers touch a kept-out call id first, and the
    // whole account says it is kept out (law 11, `view.ts` · the guard).
    const { account, texts } = await accountOf({
      result: { ok: true, exitCode: 0, stdout: '42', stderr: '' },
      answer: `It printed 42.\n\n${fenced(PROGRAM)}`,
      redact: conversationRedaction(),
    });
    expect(account.summary.sentence.template.id).toBe('scope.keptOut');
    expect(texts.filter((t) => /script/i.test(t))).toEqual([]);
    expect(texts.join('\n')).not.toContain('REDACTED');
  });
});
