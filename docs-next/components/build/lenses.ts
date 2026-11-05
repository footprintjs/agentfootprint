/** One recorded run, read five ways. */
export const LENSES = [
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
