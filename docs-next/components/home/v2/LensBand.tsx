'use client';

import { useRef } from 'react';
import { useScrollProgress } from '@/lib/home/useScrollProgress';

/**
 * "One run. Five questions." — the thesis, demonstrated instead of asserted.
 *
 * A single recorded run is pinned on the left while the reader scrolls, and the
 * SAME run is re-read five ways. Nothing about the run changes between steps;
 * only the question being asked of it does. That is the whole argument for a
 * lens family, and a paragraph cannot make it.
 *
 * SCROLL-DRIVEN, never a timer. An auto-rotating carousel moves before a slower
 * reader has finished, cannot be scanned, and hides most of its content behind a
 * clock — which on this page in particular would contradict the product. Here
 * the reader owns the pace, and `useScrollProgress` quantizes progress to a step
 * index so this re-renders five times across the whole track rather than on every
 * scroll pixel. It also handles prefers-reduced-motion by pinning the END state
 * and never subscribing to scroll at all.
 *
 * The run below is real: the backup-protection triage from a production consumer.
 * Invented numbers here would be the one dishonesty this page cannot afford.
 */
const STEPS = [
  {
    lens: 'Flow',
    question: 'What did it actually run?',
    reads: 'Every stage, in the order it took them — the chart the run really walked, not a diagram of the chart you wrote.',
  },
  {
    lens: 'Why',
    question: 'Why did it decide that?',
    reads: 'The decision and the evidence beneath it, quoted from the run, with time travel to any moment.',
  },
  {
    lens: 'Story',
    question: 'Can someone else follow it?',
    reads: 'The same run as prose, for the people who will never open a graph and still have to sign off.',
  },
  {
    lens: 'Skill graph',
    question: 'What could it even reach?',
    reads: 'Which procedure was live at each step, and the tools that step exposed — instead of a flat surface of everything.',
  },
  {
    lens: 'Data graph',
    question: 'Where did the numbers come from?',
    reads: 'How rows were shaped, tool by tool, into the ones the answer rests on. Running in an application today, landing in the lens next.',
  },
] as const;

const STAGES = ['Read the estate', 'Assess each cluster', 'Assess each subject', 'Posture', 'Collect'] as const;

function Scene({ step }: { step: number }) {
  if (step === 0) {
    return (
      <ol className="lensband-chain">
        {STAGES.map((stage) => (
          <li key={stage}>{stage}</li>
        ))}
      </ol>
    );
  }
  if (step === 1) {
    return (
      <div className="lensband-why">
        <p className="lensband-subject">posture · SQL-PSR-Nightly</p>
        <p className="lensband-ev">
          paused <b>true</b> eq true <i>✓</i>
        </p>
        <p className="lensband-ev">
          last_run_clean <b>false</b> eq false <i>✓</i>
        </p>
        <p className="lensband-verdict">→ paused-while-failing</p>
      </div>
    );
  }
  if (step === 2) {
    return (
      <p className="lensband-prose">
        It read two collected clusters, judged seven backup jobs against the declared rules, and
        found one paused while it was still failing. It could not say <em>why</em> anyone paused
        it — that record is not collected.
      </p>
    );
  }
  if (step === 3) {
    return (
      <ul className="lensband-skills">
        <li className="is-live">backup triage · 2 tools live</li>
        <li>interface triage</li>
        <li>zone redundancy audit</li>
        <li>IO profile</li>
      </ul>
    );
  }
  return (
    <ol className="lensband-pipes">
      <li>
        cohesity_backup_inventory <span>938 rows</span>
      </li>
      <li>
        vm_backup_status <span>7 rows</span>
      </li>
      <li className="is-out">
        verdicts <span>7 rows</span>
      </li>
    </ol>
  );
}

export function LensBand() {
  const trackRef = useRef<HTMLDivElement>(null);
  const step = useScrollProgress(
    trackRef,
    (progress) => Math.min(STEPS.length - 1, Math.max(0, Math.floor(progress * STEPS.length))),
    0,
  );

  return (
    <div className="lensband-track" ref={trackRef}>
      <div className="lensband-pin">
        <figure className="lensband-stage" aria-live="polite">
          <figcaption>
            One run · <span>backup_protection_triage</span>
          </figcaption>
          <Scene step={step} />
        </figure>

        <ol className="lensband-copy">
          {STEPS.map((entry, index) => (
            <li key={entry.lens} className={index === step ? 'is-active' : undefined}>
              <strong>{entry.lens}</strong>
              <em>{entry.question}</em>
              <small>{entry.reads}</small>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
