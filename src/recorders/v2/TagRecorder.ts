/**
 * TagRecorder — Groups stage executions into meaningful checkpoints (tags).
 *
 * Tags are NOT individual stages. Tags are user-meaningful moments in execution.
 * Between tags, multiple stages/subflows/loops happen. Tags collapse them.
 *
 * Like git tags on commits: browse tags, not commits. Expand a tag for detail.
 *
 * Consumer provides tag rules that match stage events. The recorder groups
 * events into tags, captures scope state at each tag point, and enables
 * time-travel navigation.
 *
 * @example
 * ```typescript
 * import { TagRecorder, agentTagRules } from 'agentfootprint/observe';
 *
 * const tags = new TagRecorder(agentTagRules());
 * executor.attachFlowRecorder(tags);
 * await executor.run();
 *
 * tags.getTags();
 * // [
 * //   { id: 'init', label: 'Initialized', entries: [...], timestamp: 0 },
 * //   { id: 'llm-1', label: 'LLM Call #1', entries: [...], timestamp: 1247 },
 * //   { id: 'tools-1', label: 'Tool Execution', entries: [...], timestamp: 1289 },
 * // ]
 *
 * // Time travel — jump to a tag:
 * tags.getTag('tools-1');
 * ```
 */

// ── Types ──────────────────────────────────────────────────────

/** Rule that defines when a new tag starts. */
export interface TagRule {
  /** Tag ID prefix (auto-suffixed with counter for repeating tags, e.g., 'llm-1', 'llm-2'). */
  readonly id: string;
  /** Human-readable label template. Use {n} for iteration number. */
  readonly label: string;
  /** Match function — returns true when this event should start a new tag. */
  readonly match: (event: TagEvent) => boolean;
}

/** Event shape passed to tag rules (simplified from FlowRecorder events). */
export interface TagEvent {
  readonly type: 'stage' | 'subflow-entry' | 'subflow-exit' | 'decision' | 'loop' | 'break' | 'error' | 'pause';
  readonly stageId?: string;
  readonly stageName: string;
  readonly subflowId?: string;
  readonly depth: number;
  readonly loopIteration?: number;
  readonly chosen?: string;
  readonly description?: string;
}

/** A captured tag — a meaningful checkpoint in execution. */
export interface Tag {
  /** Unique tag ID (e.g., 'llm-1', 'tools-2'). */
  readonly id: string;
  /** Human-readable label (e.g., 'LLM Call #1'). */
  readonly label: string;
  /** Events inside this tag. */
  readonly entries: TagEvent[];
  /** Timestamp (ms from start) when this tag was created. */
  readonly timestamp: number;
  /** Tag index (0-based). */
  readonly index: number;
}

// ── FlowRecorder types (imported shape) ────────────────────────

interface FlowRecorderEvent {
  stageName: string;
  description?: string;
  traversalContext?: {
    stageId: string;
    stageName: string;
    subflowId?: string;
    depth: number;
    loopIteration?: number;
  };
}

// ── TagRecorder ────────────────────────────────────────────────

export class TagRecorder {
  readonly id: string;
  private rules: TagRule[];
  private tags: Tag[] = [];
  private currentEntries: TagEvent[] = [];
  private currentTagRule: TagRule | null = null;
  private tagCounters = new Map<string, number>();
  private startTime = Date.now();
  private lastTagTimestamp = 0;

  constructor(rules: TagRule[], id = 'tag-recorder') {
    this.id = id;
    this.rules = rules;
  }

  // ── FlowRecorder hooks ───────────────────────────────────────

  onStageExecuted(event: FlowRecorderEvent): void {
    this.processEvent(this.toTagEvent('stage', event));
  }

  onSubflowEntry(event: { name: string; subflowId?: string; description?: string; traversalContext?: FlowRecorderEvent['traversalContext'] }): void {
    this.processEvent(this.toTagEvent('subflow-entry', {
      stageName: event.name,
      description: event.description,
      traversalContext: event.traversalContext,
    }));
  }

  onSubflowExit(event: { name: string; subflowId?: string; traversalContext?: FlowRecorderEvent['traversalContext'] }): void {
    this.processEvent(this.toTagEvent('subflow-exit', {
      stageName: event.name,
      traversalContext: event.traversalContext,
    }));
  }

  onDecision(event: { decider: string; chosen: string; description?: string; traversalContext?: FlowRecorderEvent['traversalContext'] }): void {
    this.processEvent({
      type: 'decision',
      stageId: event.traversalContext?.stageId,
      stageName: event.decider,
      subflowId: event.traversalContext?.subflowId,
      depth: event.traversalContext?.depth ?? 0,
      chosen: event.chosen,
      description: event.description,
    });
  }

  onLoop(event: { target: string; iteration: number; description?: string; traversalContext?: FlowRecorderEvent['traversalContext'] }): void {
    this.processEvent({
      type: 'loop',
      stageId: event.traversalContext?.stageId,
      stageName: event.target,
      subflowId: event.traversalContext?.subflowId,
      depth: event.traversalContext?.depth ?? 0,
      loopIteration: event.iteration,
      description: event.description,
    });
  }

  onBreak(event: { stageName: string; traversalContext?: FlowRecorderEvent['traversalContext'] }): void {
    this.processEvent(this.toTagEvent('break', event));
  }

  onError(event: { stageName: string; message?: string; traversalContext?: FlowRecorderEvent['traversalContext'] }): void {
    this.processEvent(this.toTagEvent('error', event));
  }

  onPause(event: { stageName?: string; stageId?: string; traversalContext?: FlowRecorderEvent['traversalContext'] }): void {
    if (!event.stageName) return;
    this.processEvent(this.toTagEvent('pause', {
      stageName: event.stageName,
      traversalContext: event.traversalContext,
    }));
  }

  // ── Public API ───────────────────────────────────────────────

  /** Get all tags in execution order. */
  getTags(): Tag[] {
    this.flush();
    return [...this.tags];
  }

  /** Get a specific tag by ID. */
  getTag(id: string): Tag | undefined {
    this.flush();
    return this.tags.find((t) => t.id === id);
  }

  /** Get tag at index. */
  getTagAt(index: number): Tag | undefined {
    this.flush();
    return this.tags[index];
  }

  /** Number of tags. */
  get count(): number {
    this.flush();
    return this.tags.length;
  }

  /** Reset state before each run. */
  clear(): void {
    this.tags = [];
    this.currentEntries = [];
    this.currentTagRule = null;
    this.tagCounters.clear();
    this.startTime = Date.now();
    this.lastTagTimestamp = 0;
  }

  /** Expose tags for snapshot inclusion. */
  toSnapshot(): { name: string; data: unknown } {
    this.flush();
    return { name: 'Tags', data: this.tags };
  }

  // ── Internal ─────────────────────────────────────────────────

  private processEvent(event: TagEvent): void {
    // Check if any rule matches — starts a new tag
    const matchedRule = this.rules.find((r) => r.match(event));

    if (matchedRule && matchedRule !== this.currentTagRule) {
      // Flush current tag (if any)
      this.flush();
      // Start new tag
      this.currentTagRule = matchedRule;
      this.lastTagTimestamp = Date.now() - this.startTime;
    }

    // Accumulate event into current tag
    this.currentEntries.push(event);
  }

  private flush(): void {
    if (this.currentEntries.length === 0) return;
    if (!this.currentTagRule) {
      // Events before first rule match — create an implicit "init" tag
      this.tags.push({
        id: 'init',
        label: 'Initialized',
        entries: [...this.currentEntries],
        timestamp: 0,
        index: this.tags.length,
      });
      this.currentEntries = [];
      return;
    }

    const counter = (this.tagCounters.get(this.currentTagRule.id) ?? 0) + 1;
    this.tagCounters.set(this.currentTagRule.id, counter);

    const id = counter > 1
      ? `${this.currentTagRule.id}-${counter}`
      : this.currentTagRule.id;
    const label = this.currentTagRule.label.replace('{n}', String(counter));

    this.tags.push({
      id,
      label,
      entries: [...this.currentEntries],
      timestamp: this.lastTagTimestamp,
      index: this.tags.length,
    });
    this.currentEntries = [];
  }

  private toTagEvent(type: TagEvent['type'], event: FlowRecorderEvent): TagEvent {
    return {
      type,
      stageId: event.traversalContext?.stageId,
      stageName: event.stageName,
      subflowId: event.traversalContext?.subflowId,
      depth: event.traversalContext?.depth ?? 0,
      loopIteration: event.traversalContext?.loopIteration,
      description: (event as any).description,
    };
  }
}

// ── Agent Tag Rules Preset ─────────────────────────────────────

/**
 * Tag rules for the agent loop — knows about agent stage IDs.
 *
 * Tags:
 * - "LLM Call #N" — when call-llm fires
 * - "Tool Execution" — when execute-tool-calls fires
 * - "Instructions" — when evaluate-instructions fires
 * - "Completed" — when break/finalize fires
 */
export function agentTagRules(): TagRule[] {
  return [
    {
      id: 'llm',
      label: 'LLM Call #{n}',
      match: (e) => e.stageId === 'call-llm' && e.type === 'stage',
    },
    {
      id: 'tools',
      label: 'Tool Execution',
      match: (e) => e.stageId === 'execute-tool-calls' && e.type === 'stage',
    },
    {
      id: 'instructions',
      label: 'Instructions Evaluated',
      match: (e) => e.stageId === 'evaluate-instructions' && e.type === 'stage',
    },
    {
      id: 'done',
      label: 'Completed',
      match: (e) => e.type === 'break',
    },
  ];
}
