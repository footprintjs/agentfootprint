/**
 * TRIPWIRE — why the inputs layer's batch ask is raised by ToolCalls, not
 * inside its own subflow (`stages/argumentAsk.ts`, the header).
 *
 * The design (the arguments note, § 4.3) puts a pausable `Ask` stage and a
 * `Bind` decider that loops back to it inside `sf-inputs`, which is mounted in
 * the ReAct loop body before Route. Until footprintjs 9.28.0 that placement
 * could not be resumed correctly. These three minimal charts pin the three
 * facts the placement decision rested on, as they read on footprintjs 9.28.0
 * and later:
 *
 *   1. a decider looping back to the PAUSED stage after a resume now reaches
 *      the paused stage for real — it pauses again, so a re-ask works
 *      (before 9.28.0 it re-ran the resume half and never paused again);
 *   2. a pause inside a subflow mounted in a loop body now resumes into the
 *      real loop, and the run finishes every iteration (before 9.28.0 the
 *      loop-back could not reach the loop head and the run ended silently
 *      after one stage of the next iteration);
 *   3. an `interrupt()` raised by the loop's own pausable branch resumes by
 *      re-running that branch, and the loop continues — the placement used.
 *
 * footprintjs 9.28.0 ("resume walks the real chart") FIXED facts 1 and 2, so
 * the expectations below were updated to the healthy traces. The ask MAY now
 * move into `sf-inputs` as the design drew it (and a second pause in the
 * batch that asked would no longer have to be refused). That move is a
 * TRACKED FOLLOW-UP (`src/core/agent/arguments/README.md` § "Not
 * covered"), deliberately not made in the dependency bump: revisit
 * `stages/argumentAsk.ts` there. If facts 1 or 2 ever read the OLD traces
 * again, footprintjs regressed — do not just update these expectations back.
 */

import { describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor, interrupt, type FlowChart } from 'footprintjs';
import { ArrayMergeMode } from 'footprintjs/advanced';

type S = Record<string, unknown> & { iter: number; trace: string[] };

/** Run, answering every pause with `{ n }`, each resume on a fresh executor from a JSON checkpoint. */
async function drive(chart: FlowChart, answers = 6): Promise<{ trace: string[]; pauses: number }> {
  let executor = new FlowChartExecutor(chart);
  let result = await executor.run();
  let pauses = 0;
  while ((result as { paused?: boolean })?.paused === true && pauses < answers) {
    pauses += 1;
    const checkpoint = JSON.parse(JSON.stringify(executor.getCheckpoint()));
    executor = new FlowChartExecutor(chart);
    result = await executor.resume(checkpoint, { n: pauses });
  }
  return { trace: (executor.getSnapshot().sharedState as S).trace, pauses };
}

describe('TRIPWIRE — where footprintjs can resume a pause inside the ReAct loop', () => {
  it('fact 1: a loop back to the paused stage pauses it again — the re-ask reaches the person', async () => {
    const inner = flowChart('Plan', (s: S) => void (s.log = ['plan']), 'plan')
      .addPausableFunction(
        'Ask',
        {
          execute: (s: S) => {
            s.log = [...(s.log as string[]), 'ask'];
            return { question: 'q' };
          },
          resume: (s: S) => {
            s.log = [...(s.log as string[]), 'resume-half'];
            s.rounds = ((s.rounds as number | undefined) ?? 0) + 1;
          },
        },
        'ask',
        'ask',
      )
      .addDeciderFunction(
        'Bind',
        (s: S) => ((s.rounds as number) < 2 ? 'again' : 'done'),
        'bind',
        'bind',
      )
      .addFunctionBranch('again', 'Again', () => undefined, 'again', { loopTo: 'ask' })
      .addFunctionBranch('done', 'Done', () => undefined)
      .end()
      .build();
    const chart = flowChart('Init', (s: S) => void (s.trace = []), 'init')
      .addSubFlowChartNext('sf', inner, 'Inner', {
        outputMapper: (sf: Record<string, unknown>) => ({ trace: sf.log }),
        arrayMerge: ArrayMergeMode.Replace,
      })
      .build();
    const { trace, pauses } = await drive(chart);
    expect(pauses).toBe(2); // the re-ask reached the person (1 before footprintjs 9.28.0)
    expect(trace).toEqual(['plan', 'ask', 'resume-half', 'ask', 'resume-half']);
  });

  it('fact 2: a pause in a subflow of the loop body resumes into the real loop and finishes it', async () => {
    const inner = flowChart('Start', () => undefined, 'sf-start')
      .addPausableFunction(
        'Ask',
        {
          execute: (s: S) => (s.pass === 1 ? { question: 'q' } : undefined),
          resume: () => undefined,
        },
        'sf-ask',
        'ask',
      )
      .build();
    const chart = flowChart(
      'Init',
      (s: S) => {
        s.iter = 0;
        s.trace = [];
      },
      'init',
    )
      .addFunction(
        'Head',
        (s: S) => {
          s.iter += 1;
          s.trace = [...s.trace, `head${s.iter}`];
        },
        'head',
      )
      .addSubFlowChartNext('sf-inputs', inner, 'Inputs', {
        inputMapper: (p: Record<string, unknown>) => ({ pass: p.iter }),
        arrayMerge: ArrayMergeMode.Replace,
      })
      .addDeciderFunction('Route', (s: S) => (s.iter < 3 ? 'tool-calls' : 'final'), 'route')
      .addFunctionBranch(
        'tool-calls',
        'ToolCalls',
        (s: S) => {
          s.trace = [...s.trace, `tools${s.iter}`];
        },
        'tool-calls',
        { loopTo: 'head' },
      )
      .addFunctionBranch('final', 'Final', (s: S) => {
        s.trace = [...s.trace, 'final'];
      })
      .end()
      .build();
    const { trace } = await drive(chart);
    // The healthy loop (before footprintjs 9.28.0: head1 tools1 head2, then silence).
    expect(trace).toEqual(['head1', 'tools1', 'head2', 'tools2', 'head3', 'final']);
  });

  it('fact 3: an interrupt() raised by the looping branch re-runs it on resume, and the loop continues', async () => {
    const chart = flowChart(
      'Init',
      (s: S) => {
        s.iter = 0;
        s.trace = [];
      },
      'init',
    )
      .addFunction(
        'Head',
        (s: S) => {
          s.iter += 1;
          s.trace = [...s.trace, `head${s.iter}`];
        },
        'head',
      )
      .addDeciderFunction('Route', (s: S) => (s.iter < 3 ? 'tool-calls' : 'final'), 'route')
      .addPausableFunctionBranch(
        'tool-calls',
        'ToolCalls',
        {
          execute: (s: S) => {
            if (s.iter === 1) {
              const rounds = (s.rounds as number | undefined) ?? 0;
              // The re-run a resume makes: the first interrupt() hands back the answer.
              if (rounds > 0) interrupt(s, { reason: 'the answer' });
              if (rounds < 2) {
                s.rounds = rounds + 1; // committed with the pause
                interrupt(s, { reason: `ask ${rounds + 1}` }); // (a re-ask) pauses again
              }
            }
            s.trace = [...s.trace, `tools${s.iter}`];
          },
          resume: (s: S) => {
            s.trace = [...s.trace, 'RESUME-HALF'];
          },
        },
        'tool-calls',
        { loopTo: 'head' },
      )
      .addFunctionBranch('final', 'Final', (s: S) => {
        s.trace = [...s.trace, 'final'];
      })
      .end()
      .build();
    const { trace, pauses } = await drive(chart);
    expect(pauses).toBe(2);
    expect(trace).toEqual(['head1', 'tools1', 'head2', 'tools2', 'head3', 'final']);
  });
});
