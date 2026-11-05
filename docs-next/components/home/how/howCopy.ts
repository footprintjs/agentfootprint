/** Everything How it works says. Two views change the words only. */
export type HowView = 'product' | 'technical';
export type HowChapter = 'wrong' | 'ask' | 'record' | 'walk' | 'address' | 'suspect' | 'rerun' | 'forward' | 'loop' | 'end';

export interface HowLabels {
  readonly slots: readonly [string, string, string];
  readonly record: string;
}

export const HOW_COPY: Readonly<
  Record<HowView, { readonly lede: string; readonly labels: HowLabels; readonly caps: Readonly<Record<HowChapter, { readonly h: string; readonly s: string }>> }>
> = {
  product: {
    lede: 'Inspect the answer, walk back through its context, isolate the suspect source, and test the fix by rerunning without it.',
    labels: { slots: ['system', 'messages', 'tools'], record: 'the record, written as the run happens' },
    caps: {
      wrong: { h: 'It answered wrong.', s: 'It approved a refund it should have denied. Somewhere in the context you fed it, one piece flipped the decision. Which one?' },
      ask: { h: 'Can’t you just ask a model?', s: 'Three confident answers, none falsifiable. So how do you actually know?' },
      record: { h: 'The run recorded itself.', s: 'Every step wrote a note as it happened, with no extra tracing work and no story reconstructed later.' },
      walk: { h: 'Start at the answer. Walk back.', s: 'Follow the edges from the wrong decision. Only the notes behind it light up, and the rest of the run falls away.' },
      address: { h: 'Every piece of context has an address.', s: 'Rules, skills, memory and retrieved facts stop being one invisible prompt. Each lands in system, messages or tools, at a moment you can name.' },
      suspect: { h: 'The walk ends at a suspect.', s: 'One retrieved policy sits in the system slot, and the decision read it. That is a suspect, not proof.' },
      rerun: { h: 'Remove one source. Rerun the case.', s: 'Same question, same baseline, one source gone. If the decision flips, you have evidence of dependence in this case, not hidden reasoning.' },
      forward: { h: 'Catch it before it answers.', s: 'The same record runs forward. A travel agent picks a tool by its description, and two tools tie. The library flags it. You own the fix.' },
      loop: { h: 'The loop records itself.', s: 'Prompt, ask, return, answer. Every event drains into a typed log with its own cost, as the agent runs.' },
      end: { h: 'Stop guessing why your agent answered wrong.', s: 'Record every run. Walk it back to the cause. Test the fix by replaying it.' },
    },
  },
  technical: {
    lede: 'Traverse from the wrong output through context provenance, slice backward to the suspect source, and test it with a controlled rerun.',
    labels: { slots: ['system', 'messages', 'tools'], record: 'the record, written by the runtime' },
    caps: {
      wrong: { h: 'It answered wrong.', s: 'The route ended at approved at step 14. Some injected piece of context flipped it, and the prompt alone does not say which.' },
      ask: { h: 'Can’t you just ask a model?', s: 'A model’s account of its own decision is a claim, not evidence. Three models, three confident culprits, none falsifiable.' },
      record: { h: 'The run recorded itself.', s: 'FootprintJS commits each stage’s reads and writes during traversal, so the record exists by construction.' },
      walk: { h: 'Start at the answer. Walk back.', s: 'A backward slice over the commit log. Only the stages the decision depends on stay lit. Structural slices are always correlational.' },
      address: { h: 'Every piece of context has an address.', s: 'Injection = slot × trigger × cache. Each flavor targets system, messages or tools, and recomposes per iteration under dynamic ReAct.' },
      suspect: { h: 'The walk ends at a suspect.', s: 'The ranking points at a source. Embedding scores are proxies, so this is a hypothesis until an ablation confirms it.' },
      rerun: { h: 'Remove one source. Rerun the case.', s: 'rerunWithoutSources ablates the suspect and replays under the same baseline. Causal claims come only from this kind of flip, and only for this case.' },
      forward: { h: 'Catch it before it answers.', s: 'The recorded tool choice scores each candidate. Embedding ties search_hotels and load_skill at 0.50. A rewrite breaks the tie. Bring your own scorer.' },
      loop: { h: 'The loop records itself.', s: 'Typed events drain from the hot path with deferred delivery, so tracing does not sit inside the call stack it observes.' },
      end: { h: 'Make every agent run causally queryable.', s: 'Record inline. Slice backward. Ablate the suspect. Replay the counterfactual.' },
    },
  },
};
