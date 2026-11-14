/** A deliberately faulty native test chart, based on the existing trace-debug example. */
import { decide, flowChart, FlowChartExecutor } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';
import { createHash } from 'node:crypto';
import { INPUTS } from './cases.mjs';

const FIELDS = { annual: 'annualIncome', monthly: 'monthlyIncome' };
const RULES = [
  { when: { creditScore: { lt: 620 } }, then: 'decline', label: 'Credit score below floor' },
  { when: { dti: { gt: 0.4 } }, then: 'decline', label: 'Monthly ratio above ceiling' },
  {
    when: { creditScore: { gte: 680 }, dti: { lte: 0.4 } },
    then: 'approve',
    label: 'Within policy',
  },
];

export const TASK = Object.freeze({
  question:
    'Check whether this decision follows the monthly affordability policy. Keep correct code or propose one denominator-field correction.',
  policy:
    'Decline below credit score 620 or above monthly debt/income ratio 0.4; approve score 680 or higher within the ratio; otherwise refer.',
  responseShape: {
    operation: 'keep | denominator',
    field: 'annualIncome | monthlyIncome (denominator only)',
  },
});

export function chartFor(variant, logs) {
  if (!Object.hasOwn(FIELDS, variant)) throw new Error('Unknown fixture variant');
  const field = FIELDS[variant];
  const log = (stage, facts) => logs.push(JSON.stringify({ stage, ...facts }));
  return flowChart(
    'Intake',
    (scope) => {
      const input = scope.$getArgs().application;
      scope.annualIncome = input.annualIncome;
      scope.monthlyDebt = input.monthlyDebt;
      scope.creditScore = input.creditScore;
      scope.monthlyIncome = input.annualIncome / 12;
      log('intake', {
        annualIncome: scope.annualIncome,
        monthlyIncome: scope.monthlyIncome,
        monthlyDebt: scope.monthlyDebt,
        creditScore: scope.creditScore,
      });
    },
    'intake',
  )
    .addFunction(
      'Normalize',
      (scope) => {
        scope.dti = Math.round((scope.monthlyDebt / scope[field]) * 1000) / 1000;
        log('normalize', { dti: scope.dti });
      },
      'normalize',
    )
    .addDeciderFunction('Adjudicate', (scope) => decide(scope, RULES, 'refer'), 'adjudicate')
    .addFunctionBranch('approve', 'Approve', (scope) => {
      scope.decision = 'approve';
      log('decision', { decision: scope.decision });
    })
    .addFunctionBranch('decline', 'Decline', (scope) => {
      scope.decision = 'decline';
      log('decision', { decision: scope.decision });
    })
    .addFunctionBranch('refer', 'Refer', (scope) => {
      scope.decision = 'refer';
      log('decision', { decision: scope.decision });
    })
    .end()
    .build();
}

/** Both evidence arms are collected from this same completed run. No model participates. */
export async function captureCase(caseDef, input = INPUTS) {
  const logs = [];
  const executor = new FlowChartExecutor(chartFor(caseDef.variant, logs));
  const controls = controlDepRecorder();
  executor.attachCombinedRecorder(controls);
  executor.enableNarrative();
  await executor.run({ input: { application: { ...input } } });
  const snapshot = executor.getSnapshot();
  return {
    captureDigest: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    logs: logs.join('\n'),
    decision: snapshot.sharedState.decision,
    dti: snapshot.sharedState.dti,
    captureStatus: caseDef.capture === 'missing' ? 'missing' : 'complete',
    artifacts:
      caseDef.capture === 'missing'
        ? undefined
        : {
            snapshot,
            narrative: executor.getNarrativeEntries().map((entry) => entry.text),
            controlDeps: controls.asLookup(),
          },
    limitations: [
      'Initial $getArgs() input is untracked; tool responses retain their coverage warnings.',
    ],
  };
}
