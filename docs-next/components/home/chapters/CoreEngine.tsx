'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Chapter 3 — "The engine". The deep "how it's implemented" beat, told as TWO
 * dedicated, separately-pinned containers (each its own header — no shared sticky
 * cross-fade):
 *
 *  Animation 1 — "the loop records itself". A dedicated card holds the constant ReAct
 *  flowchart on the left; scrolling time-travels the recorded run — each step lights its
 *  node, draws a traveling coral arrow along its edge (like the backtrack animation), and
 *  appends a row to the drain log on the right. A scrubber + running ms/tok/steps tally
 *  track where you are. Scroll back and forth = scrub the footprint.
 *
 *  Animation 2 — "and it costs the run nothing". Its own dedicated container: a vertical
 *  event-loop diagram. The stage queues trace events on the hot path; the IDLE BEAT
 *  flushes them to listeners + trace memory ONE BEAT BEHIND — collect during traversal,
 *  off the critical path, zero added latency.
 */

type StepKind = 'prompt' | 'inject' | 'assemble' | 'ask' | 'route' | 'ret' | 'answer' | 'loop';
type NodeId = 'ctx' | 'sys' | 'msg' | 'tool' | 'api' | 'llm' | 'route' | 'final' | 'tc';
type EdgeId =
  | 'ctx-sys'
  | 'ctx-msg'
  | 'ctx-tool'
  | 'sys-api'
  | 'msg-api'
  | 'api-llm'
  | 'tool-llm'
  | 'llm-route'
  | 'route-final'
  | 'route-tc'
  | 'loop';

type Step = {
  kind: StepKind;
  label: string;
  text: React.ReactNode;
  ms: number;
  tok: number;
  node: NodeId;
  nodes?: NodeId[]; // extra waypoint nodes this beat lights (e.g. the Route diamond), beyond `node`
  edge?: EdgeId; // the primary hop (gets the head pulse); also the one the arrowhead pops on
  edges?: EdgeId[]; // a step may traverse several edges at once (e.g. assemble pulls all 3 slots)
  tone?: 'teal'; // a second-iteration / answer beat — rendered teal so it reads apart from the coral first pass
};

// One ReAct iteration + the answer, as recorded steps. The request is ASSEMBLED, never skipped:
// System Prompt + Messages converge at messageAPI; then messageAPI together with Tools all reach
// CallLLM. A tool call routes CallLLM → Route → ToolCalls, and the result LOOPS BACK to Context
// for the next turn (it does not snap straight back to CallLLM).
const STEPS: Step[] = [
  { kind: 'prompt', label: 'prompt', text: 'assemble the context for this turn', ms: 180, tok: 90, node: 'ctx' },
  {
    kind: 'inject',
    label: 'rule ↳',
    text: (
      <>
        <b>steering</b> · always &rarr; <b>system</b>
      </>
    ),
    ms: 60,
    tok: 40,
    node: 'sys',
    edge: 'ctx-sys',
  },
  {
    kind: 'inject',
    label: 'rule ↳',
    text: (
      <>
        memory recall &rarr; <b>messages</b>
      </>
    ),
    ms: 80,
    tok: 120,
    node: 'msg',
    edge: 'ctx-msg',
  },
  {
    kind: 'inject',
    label: 'skill ↳',
    text: (
      <>
        skill unlocks &rarr; <b>search_hotels</b> tool
      </>
    ),
    ms: 90,
    tok: 70,
    node: 'tool',
    edge: 'ctx-tool',
  },
  {
    kind: 'assemble',
    label: 'assemble',
    text: (
      <>
        <b>system</b> + <b>messages</b> converge &rarr; <b>messageAPI</b>
      </>
    ),
    ms: 40,
    tok: 0,
    node: 'api',
    edge: 'msg-api',
    edges: ['sys-api', 'msg-api'],
  },
  {
    kind: 'ask',
    label: 'ask',
    text: (
      <>
        <b>messageAPI</b> + <b>tools</b> &rarr; <b>CallLLM</b> wants search_hotels
      </>
    ),
    ms: 260,
    tok: 120,
    node: 'llm',
    edge: 'api-llm',
    edges: ['api-llm', 'tool-llm'],
  },
  {
    kind: 'route',
    label: 'route',
    text: (
      <>
        Route &rarr; <b>ToolCalls</b> — a tool call, not the answer
      </>
    ),
    ms: 30,
    tok: 0,
    node: 'tc',
    nodes: ['route'],
    edge: 'route-tc',
    edges: ['llm-route', 'route-tc'],
  },
  {
    kind: 'ret',
    label: 'return',
    text: (
      <>
        <b>search_hotels</b> &rarr; 6 hotels · <b>loops back</b>
      </>
    ),
    ms: 600,
    tok: 320,
    node: 'ctx',
    edge: 'loop',
  },
  // ── second iteration (teal): only the path the tool result CHANGED re-runs ──
  {
    kind: 'inject',
    label: 'result ↳',
    text: (
      <>
        tool result &rarr; appended to <b>messages</b>
      </>
    ),
    ms: 50,
    tok: 300,
    node: 'msg',
    edge: 'ctx-msg',
    tone: 'teal',
  },
  {
    kind: 'assemble',
    label: 'assemble',
    text: (
      <>
        <b>messageAPI</b> re-assembles · with the result
      </>
    ),
    ms: 40,
    tok: 0,
    node: 'api',
    edge: 'msg-api',
    tone: 'teal',
  },
  {
    kind: 'ask',
    label: 'ask',
    text: (
      <>
        <b>CallLLM</b> again &rarr; now it can answer
      </>
    ),
    ms: 240,
    tok: 160,
    node: 'llm',
    edge: 'api-llm',
    tone: 'teal',
  },
  {
    kind: 'answer',
    label: 'answer',
    text: (
      <>
        Route &rarr; <b>Final</b> &mdash; &ldquo;6 options in Lisbon.&rdquo;
      </>
    ),
    ms: 50,
    tok: 0,
    node: 'final',
    nodes: ['route'],
    edge: 'route-final',
    edges: ['llm-route', 'route-final'],
    tone: 'teal',
  },
];

type FlowNode = { id: NodeId; nt: string; ns?: string; x: number; y: number; cls?: string; flavor?: string };
const NODES: FlowNode[] = [
  { id: 'ctx', nt: 'Context', ns: 'ReAct loop', x: 50, y: 11 },
  { id: 'sys', nt: 'System Prompt', x: 18, y: 30, cls: 'pill', flavor: 'coral' },
  { id: 'msg', nt: 'Messages', x: 50, y: 30, cls: 'pill', flavor: 'purple' },
  { id: 'tool', nt: 'Tools', x: 82, y: 30, cls: 'pill', flavor: 'teal' },
  { id: 'api', nt: 'messageAPI', ns: 'assemble', x: 50, y: 50.5 },
  { id: 'llm', nt: 'CallLLM', ns: 'send request', x: 50, y: 69.5 },
  { id: 'route', nt: 'Route', ns: 'route', x: 50, y: 84, cls: 'diamond' },
  { id: 'final', nt: 'Final', ns: 'answer', x: 24, y: 94 },
  { id: 'tc', nt: 'ToolCalls', ns: 'execute', x: 76, y: 94 },
];

const EDGES: { id: EdgeId; d: string; loop?: boolean }[] = [
  { id: 'ctx-sys', d: 'M50,11 L20.2,11 Q18,11 18,15.5 L18,30' },
  { id: 'ctx-msg', d: 'M50,11 L50,30' },
  { id: 'ctx-tool', d: 'M50,11 L79.8,11 Q82,11 82,15.5 L82,30' },
  { id: 'sys-api', d: 'M18,30 L18,46 Q18,50.5 20.2,50.5 L50,50.5' },
  { id: 'msg-api', d: 'M50,30 L50,50.5' },
  { id: 'api-llm', d: 'M50,50.5 L50,69.5' },
  { id: 'tool-llm', d: 'M82,30 L82,65 Q82,69.5 79.8,69.5 L50,69.5' },
  { id: 'llm-route', d: 'M50,69.5 L50,84' },
  { id: 'route-final', d: 'M50,84 L24,94' },
  { id: 'route-tc', d: 'M50,84 L76,94' },
  { id: 'loop', d: 'M76,94 L96,94 L96,7 L52,7', loop: true },
];

// Forward arrowhead per hop: a mid-edge point (viewBox units) + rotation pointing toward the
// DOWNSTREAM node (the direction of flow). Same technique as BacktrackStory's HOP_ARROWS, but
// forward (downstream) instead of backward. Triangle d points +x by default; rotate clockwise.
const HOP_ARROWS: Record<string, { x: number; y: number; a: number }> = {
  'ctx-sys': { x: 18, y: 22, a: 90 }, // down into System Prompt
  'ctx-msg': { x: 50, y: 19, a: 90 }, // down into Messages
  'ctx-tool': { x: 82, y: 22, a: 90 }, // down into Tools
  'sys-api': { x: 40, y: 50.5, a: 0 }, // right into messageAPI
  'msg-api': { x: 50, y: 44, a: 90 }, // down into messageAPI
  'api-llm': { x: 50, y: 61, a: 90 }, // down into CallLLM (messageAPI → CallLLM)
  'tool-llm': { x: 66, y: 69.5, a: 180 }, // left into CallLLM (tools join the call)
  'llm-route': { x: 50, y: 75, a: 90 }, // down into Route
  'route-tc': { x: 64, y: 90, a: 22 }, // down-right into ToolCalls
  'route-final': { x: 36, y: 90, a: 158 }, // down-left into Final
  loop: { x: 62, y: 7, a: 180 }, // left into Context (the result loops back)
};

// plain-language narration of what THIS beat is doing — shown under the animation, per step
function beatNote(step: Step | undefined): string {
  if (!step) return 'Scroll to step through the recorded run.';
  switch (step.kind) {
    case 'prompt':
      return 'The turn begins — Context is assembled.';
    case 'inject':
      if (step.label.startsWith('skill')) return 'A skill unlocks a tool — injected into Tools.';
      if (step.label.startsWith('result')) return 'The tool result is appended to Messages.';
      return 'A rule injects context into a slot.';
    case 'assemble':
      return 'messageAPI assembles System Prompt + Messages into the request.';
    case 'ask':
      return 'CallLLM sends the request — messageAPI and Tools converge here.';
    case 'route':
      return 'Route sends the model to ToolCalls — a tool call, not the answer.';
    case 'ret':
      return 'The tool runs; its result loops back to Context for the next turn.';
    case 'answer':
      return 'Route reaches Final — the answer.';
    default:
      return '';
  }
}

// ---- shared flowchart state, computed for a given number of revealed steps ----
type FlowState = {
  litNodes: Set<NodeId>;
  litEdges: Set<EdgeId>;
  tealNodes: Set<NodeId>;
  tealEdges: Set<EdgeId>;
  counts: Partial<Record<NodeId, number>>;
  curStep?: Step;
  flowEdge?: { id: EdgeId; d: string; loop?: boolean };
};
function computeFlowState(emitted: number): FlowState {
  const litNodes = new Set<NodeId>();
  const litEdges = new Set<EdgeId>();
  const tealNodes = new Set<NodeId>();
  const tealEdges = new Set<EdgeId>();
  const counts: Partial<Record<NodeId, number>> = {};
  for (let k = 0; k < emitted; k++) {
    const s = STEPS[k];
    litNodes.add(s.node);
    counts[s.node] = (counts[s.node] ?? 0) + 1;
    s.nodes?.forEach((n) => {
      litNodes.add(n);
      counts[n] = (counts[n] ?? 0) + 1;
    });
    if (s.edge) litEdges.add(s.edge);
    s.edges?.forEach((e) => litEdges.add(e));
    if (s.tone === 'teal') {
      tealNodes.add(s.node);
      s.nodes?.forEach((n) => tealNodes.add(n));
      if (s.edge) tealEdges.add(s.edge);
      s.edges?.forEach((e) => tealEdges.add(e));
    }
  }
  const curStep = emitted > 0 ? STEPS[emitted - 1] : undefined;
  const flowEdge = curStep?.edge ? EDGES.find((e) => e.id === curStep.edge) : undefined;
  return { litNodes, litEdges, tealNodes, tealEdges, counts, curStep, flowEdge };
}

// The constant ReAct flowchart — reused by BOTH animations (it lights per scroll step).
function FlowChartView({ state, emitted }: { state: FlowState; emitted: number }) {
  const { litNodes, litEdges, tealNodes, tealEdges, counts, curStep, flowEdge } = state;
  return (
    <div className="af-eng-flow">
      <svg className="af-eng-fedges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {EDGES.map((ed) => (
          <path
            key={ed.id}
            d={ed.d}
            pathLength={1}
            className={`af-eng-fe${ed.loop ? ' loop' : ''}${litEdges.has(ed.id) ? ' lit' : ''}${
              tealEdges.has(ed.id) ? ' answer' : ''
            }`}
          />
        ))}
        {[...litEdges]
          .filter((e) => HOP_ARROWS[e])
          .map((e) => {
            const a = HOP_ARROWS[e];
            return (
              <path
                key={`ah-${e}`}
                className={`af-eng-fe-arrow${e === curStep?.edge ? ' head' : ''}${tealEdges.has(e) ? ' answer' : ''}`}
                d="M-1.7,-1.5 L1.9,0 L-1.7,1.5 Z"
                transform={`translate(${a.x} ${a.y}) rotate(${a.a})`}
              />
            );
          })}
        {flowEdge && (
          <path
            key={`pulse-${emitted}`}
            className={`af-eng-fe-pulse${curStep?.tone === 'teal' ? ' answer' : ''}`}
            d={flowEdge.d}
            pathLength={1}
          />
        )}
      </svg>
      {NODES.map((nd) => {
        const lit = litNodes.has(nd.id);
        const c = counts[nd.id];
        const isCur = curStep?.node === nd.id;
        const cls = [
          'af-eng-fnode',
          nd.cls || '',
          lit ? 'lit' : '',
          isCur ? 'cur' : '',
          tealNodes.has(nd.id) ? 'answer' : '',
        ]
          .join(' ')
          .trim();
        return (
          <div key={nd.id} className={cls} data-flavor={nd.flavor} style={{ left: `${nd.x}%`, top: `${nd.y}%` }}>
            {nd.cls === 'pill' ? (
              <>
                <span className="af-eng-dot" />
                {nd.nt}
              </>
            ) : (
              <>
                <b>{nd.nt}</b>
                {nd.ns && <span>{nd.ns}</span>}
              </>
            )}
            {lit && c && nd.cls !== 'diamond' ? <i className="af-eng-fcount">{c}</i> : null}
          </div>
        );
      })}
    </div>
  );
}

// the four trace channels every stage emits (color = the trace event's owner). Each color is a
// theme var so the diagram adapts to light AND dark (defined on .af-el / .dark .af-el in CSS).
const EL_EVENTS = [
  { v: 'var(--el-struct)', name: 'onStageAdded' },
  { v: 'var(--el-data)', name: 'onCommit' },
  { v: 'var(--el-control)', name: 'onDecision' },
  { v: 'var(--el-emit)', name: 'onEmit' },
];
// a point (+ tangent rotation) at fraction f around the loop ellipse: top = call stack (f=0),
// bottom = idle time (f=0.5). center (550,300), rx 150, ry 120 — matches the reference SVG.
function loopPoint(f: number) {
  const th = f * 2 * Math.PI;
  return {
    x: 550 + 150 * Math.sin(th),
    y: 300 - 120 * Math.cos(th),
    rot: (Math.atan2(120 * Math.sin(th), 150 * Math.cos(th)) * 180) / Math.PI,
  };
}

// The right side of animation 2: the browser-engine EVENT LOOP, faithful to the README
// reference (docs/assets/event-loop-light.svg) but SCROLL-DRIVEN per stage instead of the
// 18s CSS timeline. Each beat: the stage runs as a CALL STACK frame and feeds four trace
// events into the trace queue; then the cursor rides to IDLE TIME and the dispatcher flushes
// them to TRACE MEMORY + every listener — one beat behind, never blocking the hot path.
function EventLoopView({ prog }: { prog: number }) {
  const total = STEPS.length;
  const p2 = Math.min(total, Math.max(0, prog) * total);
  const emitted2 = Math.min(total, Math.max(1, Math.ceil(p2)));
  const curStep = STEPS[emitted2 - 1];
  const beatFrac = Math.min(1, Math.max(0, p2 - (emitted2 - 1))); // 0..1 within the current beat
  const teal = curStep?.tone === 'teal';
  const accent = teal ? '#0E8A82' : '#C2410C';
  const stageName = curStep ? (NODES.find((n) => n.id === curStep.node)?.nt ?? curStep.label) : '—';

  const cur = loopPoint(beatFrac); // the cursor rides the loop as you scroll the beat
  const running = beatFrac < 0.5; // stage holds the stack (hot path)
  const flushProg = Math.min(1, Math.max(0, (beatFrac - 0.5) / 0.4)); // events fly to memory
  const flushing = flushProg > 0;
  const drained = Math.max(0, emitted2 - 1) + (beatFrac >= 0.95 ? 1 : 0); // recorded, one beat behind
  const memRows = Math.min(6, Math.round((drained / total) * 6));

  return (
    <div className="af-el">
      <svg className="af-el-svg" viewBox="392 116 968 462" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <marker id="elArc" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="1.7" markerHeight="1.7" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--el-grey)' }} />
          </marker>
          <marker id="elFeed" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--el-green)' }} />
          </marker>
          <marker id="elDrop" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--el-green)' }} />
          </marker>
        </defs>

        <text className="af-el-sect" x="430" y="150">
          THE EVENT LOOP — THE RUNTIME
        </text>

        {/* the loop: two bold arrows (JS-native machinery), brighter on the side the cursor rides */}
        <path
          className="af-el-arc"
          d="M 671.4 229.5 A 150 120 0 0 1 650.4 389.2"
          fill="none"
          strokeWidth="18"
          markerEnd="url(#elArc)"
          opacity={running ? 0.22 : 0.6}
        />
        <path
          className="af-el-arc"
          d="M 449.6 389.2 A 150 120 0 0 1 422.8 236.4"
          fill="none"
          strokeWidth="18"
          markerEnd="url(#elArc)"
          opacity={running ? 0.6 : 0.22}
        />
        <text className="af-el-cap" x="722" y="300">
          the event loop
        </text>
        <text className="af-el-wink" x="722" y="318">
          one tick every 16ms
        </text>

        {/* stop 1 — CALL STACK (grey, the runtime owns it) */}
        <rect className="af-el-greybox" x="432" y="178" width="236" height="130" rx="12" strokeWidth="1.6" />
        <text className="af-el-sect" x="550" y="200" textAnchor="middle">
          CALL STACK
        </text>
        <text className="af-el-cue" x="550" y="226" textAnchor="middle" style={{ opacity: flushing ? 1 : 0.25 }}>
          stack empty ↘ flush
        </text>
        {/* the running stage as a frame — pushes on while it runs, pops at flush */}
        <g key={`frame-${emitted2}`} style={{ opacity: beatFrac < 0.55 ? 1 : 0, transition: 'opacity 0.2s' }}>
          <rect className="af-el-framebox" x="455" y="246" width="190" height="40" rx="10" stroke={accent} strokeWidth="1.8" />
          <text className="af-el-frame-t" x="550" y="271" textAnchor="middle" fill={accent}>
            {stageName}()
          </text>
        </g>

        {/* feed: the running frame emits its four events into the trace queue */}
        <g style={{ opacity: running && beatFrac > 0.06 ? 1 : 0, transition: 'opacity 0.15s' }}>
          {[526, 542, 558, 574].map((x, i) => (
            <path
              key={i}
              className="af-el-feed"
              d={`M ${x} 312 L ${[515, 537, 561, 585][i]} 350`}
              fill="none"
              strokeWidth="1.5"
              markerEnd="url(#elFeed)"
            />
          ))}
        </g>

        {/* trace queue at the loop's center */}
        <rect className="af-el-greenbox" x="496" y="346" width="108" height="32" rx="9" strokeWidth="1.2" opacity="0.9" />
        <text className="af-el-gap" x="550" y="392" textAnchor="middle">
          trace queue
        </text>

        {/* stop 2 — IDLE TIME (footprintjs green, the dispatcher) */}
        <rect className="af-el-greenbox" x="432" y="396" width="236" height="96" rx="12" strokeWidth={flushing ? 3 : 1.5} />
        <text className="af-el-sect af-el-ginks" x="550" y="448" textAnchor="middle">
          IDLE TIME
        </text>
        <text className="af-el-gap af-el-ginks" x="550" y="466" textAnchor="middle">
          the dispatcher
        </text>

        {/* the cursor — the loop's attention, riding the ellipse as you scroll */}
        <path
          className="af-el-cursor"
          d="M -9 -6.5 L 12 0 L -9 6.5 Z"
          strokeWidth="1.5"
          transform={`translate(${cur.x} ${cur.y}) rotate(${cur.rot})`}
        />

        {/* flush #1 — the dispatcher FILES the records into trace memory (deferred) */}
        <path
          className="af-el-flush"
          d="M 668 452 C 690 460 702 462 716 462"
          fill="none"
          strokeWidth="2"
          strokeDasharray="2 7"
          markerEnd="url(#elDrop)"
          style={{ opacity: flushing ? 0.95 : 0.14 }}
        />
        <text className="af-el-gap af-el-ginks" x="694" y="430" textAnchor="middle" style={{ opacity: flushing ? 1 : 0.35 }}>
          files records
        </text>

        {/* TRACE MEMORY — the captured run accumulates here, append-only */}
        <rect className="af-el-greenbox" x="720" y="430" width="300" height="80" rx="26" strokeWidth="1.7" />
        <text className="af-el-mem" x="870" y="460" textAnchor="middle">
          TRACE MEMORY
        </text>
        <g opacity="0.85">
          {Array.from({ length: memRows }).map((_, r) =>
            EL_EVENTS.map((ev, i) => (
              <circle key={`${r}-${i}`} cx={772 + r * 40 + i * 10} cy="488" r="4.3" style={{ fill: ev.v }} />
            )),
          )}
        </g>

        {/* flush #2 — the dispatcher ALSO calls every listener back (one beat behind) */}
        {EL_EVENTS.map((ev, i) => (
          <path
            key={`disp-${i}`}
            className="af-el-flush"
            d={`M 1022 ${450 + (i - 1.5) * 5} L 1098 ${410 + i * 38}`}
            fill="none"
            strokeWidth="1.4"
            strokeDasharray="2 6"
            markerEnd="url(#elDrop)"
            style={{ opacity: flushing ? 0.85 : 0.12 }}
          />
        ))}
        <text className="af-el-sect" x="1102" y="392">
          YOUR LISTENERS
        </text>
        {EL_EVENTS.map((ev, i) => (
          <g key={ev.name} style={{ opacity: flushing ? 1 : 0.4, transition: 'opacity 0.2s' }}>
            <rect className="af-el-framebox" x="1102" y={400 + i * 38} width="236" height="30" rx="9" strokeWidth="1.4" style={{ stroke: ev.v }} />
            <circle cx="1118" cy={415 + i * 38} r="4.5" style={{ fill: ev.v }} />
            <text className="af-el-code" x="1132" y={420 + i * 38} style={{ fill: ev.v }}>
              {ev.name}(e)
            </text>
          </g>
        ))}
        <text className="af-el-cap" x="1220" y={400 + 4 * 38 + 14} textAnchor="middle">
          every listener gets every event
        </text>

        {/* the four trace events — drawn LAST so they ride ON TOP of the boxes while in flight
            (otherwise the TRACE MEMORY box paints over them as they land). Held in the queue
            while the stage runs; on the idle beat they fly out — the QUEUE drains while memory
            accumulates (append-only). */}
        {EL_EVENTS.map((ev, i) => {
          const qx = 514 + i * 24;
          const mx = 766 + i * 18;
          const x = qx + (mx - qx) * flushProg;
          const y = 362 + (470 - 362) * flushProg;
          return (
            <circle
              key={ev.name}
              cx={x}
              cy={y}
              r="7.5"
              style={{ fill: ev.v }}
              stroke="var(--el-box)"
              strokeWidth="1.5"
              opacity={running && beatFrac < 0.06 ? 0 : flushProg > 0.92 ? 0 : 1}
            />
          );
        })}
      </svg>
    </div>
  );
}

// scroll-driven 0..1 progress through a pinned track (the only driver — no timers).
// NOTE: progress always starts at 0 on both server and client first render, so there is
// no hydration mismatch. The actual MOTION (the traveling pulse, blink, row-in keyframes)
// is suppressed under prefers-reduced-motion via CSS @media queries, not by branching the
// rendered output here — branching render on a client-only value (matchMedia) is exactly
// what caused React #418 for reduced-motion users.
function usePinProgress(ref: React.RefObject<HTMLDivElement | null>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const pin = ref.current;
        if (!pin) return;
        const rect = pin.getBoundingClientRect();
        const total = pin.offsetHeight - window.innerHeight;
        const v = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
        setP(v);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return p;
}

export function CoreEngine() {
  const pinA = useRef<HTMLDivElement>(null); // animation 1 — records itself
  const pinB = useRef<HTMLDivElement>(null); // animation 2 — costs nothing
  const logScrollRef = useRef<HTMLDivElement>(null);

  const progA = usePinProgress(pinA);
  const progB = usePinProgress(pinB);

  // ---- animation 1: scroll time-travels the recorded run ----
  const emitted = Math.min(STEPS.length, Math.max(1, Math.ceil(progA * STEPS.length)));
  const done1 = emitted >= STEPS.length;

  // keep the log scrolled to the newest revealed row as you time-travel
  useEffect(() => {
    const el = logScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [emitted]);

  const tally = STEPS.slice(0, emitted).reduce(
    (a, s) => (s.kind === 'loop' ? a : { ms: a.ms + s.ms, tok: a.tok + s.tok, steps: a.steps + 1 }),
    { ms: 0, tok: 0, steps: 0 },
  );
  const totalSteps = STEPS.filter((s) => s.kind !== 'loop').length;
  const stepNow = STEPS.slice(0, emitted).filter((s) => s.kind !== 'loop').length;

  // the shared flowchart state for animation 1 (driven by progA)
  const state1 = computeFlowState(emitted);

  // bottom caption narrates THIS beat — updates every step as you scroll
  const capA = done1 ? (
    <>
      {'Full run recorded — '}
      <b>scrub back and forth</b>
      {' to time-travel the footprint, every node a row.'}
    </>
  ) : (
    <>
      <b>{`Step ${Math.max(1, stepNow)} / ${totalSteps}`}</b>
      {` — ${beatNote(state1.curStep)} It emits to the recorder as it happens.`}
    </>
  );

  // ---- animation 2: the SAME flowchart (left, stepped per stage) beside the event loop (right) ----
  const emitted2 = Math.min(STEPS.length, Math.max(1, Math.ceil(progB * STEPS.length)));
  const state2 = computeFlowState(emitted2);
  const curStep2 = state2.curStep;
  const stageName2 = curStep2 ? (NODES.find((n) => n.id === curStep2.node)?.nt ?? curStep2.label) : '—';
  const stepNow2 = STEPS.slice(0, emitted2).length;
  const beatFrac2 = Math.min(1, Math.max(0, progB * STEPS.length - (emitted2 - 1)));
  const flushing2 = beatFrac2 >= 0.5;

  // bottom caption narrates THIS beat AND its phase (run on the stack vs idle-beat flush)
  const capB = (
    <>
      <b>{`Stage ${stageName2} (${stepNow2}/${STEPS.length})`}</b>
      {flushing2
        ? ' — the idle beat flushes its trace events to memory and every listener, one beat behind.'
        : ' — runs on the call stack and feeds its trace events into the queue, on the hot path.'}
    </>
  );

  return (
    <div className="af-eng">
      {/* ---------- HERO ---------- */}
      <section className="af-eng-hero">
        <p className="af-eng-eyebrow">03 · the core engine</p>
        <h1 className="af-eng-h1">
          The brain thinks, asks a tool, <em>loops to the answer.</em>
        </h1>
        <p className="af-eng-lede">
          Every step is emitted as it happens &mdash; no instrumentation, no backtracking yet.
          agentfootprint just records the real flow as the loop runs.
        </p>

        <div className="af-eng-mental">
          <svg viewBox="0 0 1160 380" role="img" className="af-eng-mental-svg">
            <title>
              The brain thinks, asks a tool, and gets back data (reason), an instruction (act), or
              both, looping to the answer.
            </title>
            <defs>
              <linearGradient id="afEngBrain" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#E68A52" />
                <stop offset="1" stopColor="#C0531F" />
              </linearGradient>
            </defs>
            <g fill="none" strokeLinecap="round">
              <path className="af-eng-flow" d="M232 196 Q305 256 376 200" stroke="#A8906E" strokeWidth="2.4" />
              <path d="M372 205 l8 -7 l-2 10 Z" fill="#A8906E" stroke="none" />
              <path className="af-eng-flow" d="M376 142 Q305 84 234 146" stroke="#6E5C49" strokeWidth="2.4" />
              <path d="M238 142 l-8 7 l2 -10 Z" fill="#6E5C49" stroke="none" />
            </g>
            <text x="305" y="250" className="af-eng-tag" textAnchor="middle">
              asks for what it&rsquo;s missing
            </text>
            <text x="305" y="100" className="af-eng-tag" textAnchor="middle">
              tool replies
            </text>
            <g transform="translate(111 118) scale(1.05)">
              <g className="af-eng-brn">
                <path
                  d="M56 9 C64 3 77 5 81 14 C92 11 101 20 97 31 C105 36 106 48 97 54 C103 63 98 74 88 75 C85 85 73 89 65 82 C61 88 51 88 47 82 C39 89 27 85 24 75 C14 74 9 63 15 54 C6 48 7 36 15 31 C11 20 20 11 31 14 C35 5 48 3 56 9 Z"
                  fill="url(#afEngBrain)"
                  stroke="#FBF6EC"
                  strokeWidth="3"
                  strokeLinejoin="round"
                />
                <g fill="#2C1F15">
                  <circle cx="47" cy="46" r="5.5" />
                  <circle cx="65" cy="46" r="5.5" />
                </g>
                <path d="M50 60 q6 6 12 0" fill="none" stroke="#2C1F15" strokeWidth="3" strokeLinecap="round" />
              </g>
            </g>
            <text x="170" y="262" className="af-eng-nm" textAnchor="middle">
              LLM brain
            </text>
            <g>
              <rect x="382" y="132" width="96" height="74" rx="13" fill="#F4EBDB" stroke="#E6D8C2" strokeWidth="1.5" />
              <rect x="382" y="132" width="96" height="22" rx="11" fill="#E6D8C2" />
              <rect x="420" y="126" width="20" height="9" rx="4" fill="#6E5C49" />
              <g fill="#A8906E">
                <rect x="402" y="170" width="9" height="22" rx="2" />
                <rect x="425" y="170" width="9" height="22" rx="2" />
                <rect x="448" y="170" width="9" height="22" rx="2" />
              </g>
            </g>
            <text x="430" y="262" className="af-eng-nm" textAnchor="middle">
              tools
            </text>
            <g fill="none" stroke="#6E5C49" strokeLinecap="round">
              <path className="af-eng-flow" d="M486 190 H534" strokeWidth="2.2" />
              <path d="M540 118 V262" strokeWidth="2" opacity=".5" />
              <path d="M534 190 H540 M540 116 H558 M540 190 H558 M540 264 H558" strokeWidth="2" opacity=".5" />
            </g>
            <text x="560" y="74" className="af-eng-tag">
              a tool reply is one of &mdash;
            </text>
            <g className="af-eng-r1">
              <rect x="560" y="88" width="360" height="56" rx="28" fill="#DCF0ED" stroke="#E6D8C2" strokeWidth="1.5" />
              <circle cx="588" cy="116" r="17" fill="#0E8A82" />
              <text x="620" y="117" className="af-eng-lbl" dominantBaseline="middle">
                data
              </text>
              <text x="904" y="117" className="af-eng-sub" textAnchor="end" dominantBaseline="middle">
                &rarr; reason
              </text>
            </g>
            <g className="af-eng-r2">
              <rect x="560" y="162" width="360" height="56" rx="28" fill="#F8EBCC" stroke="#E6D8C2" strokeWidth="1.5" />
              <circle cx="588" cy="190" r="17" fill="#C98512" />
              <text x="620" y="191" className="af-eng-lbl" dominantBaseline="middle">
                instruction
              </text>
              <text x="904" y="191" className="af-eng-sub" textAnchor="end" dominantBaseline="middle">
                &rarr; act · skill / steering
              </text>
            </g>
            <g className="af-eng-r3">
              <rect x="560" y="236" width="360" height="56" rx="28" fill="#F4EBDB" stroke="#E6D8C2" strokeWidth="1.5" />
              <circle cx="588" cy="264" r="17" fill="#0E8A82" />
              <path d="M571 264 a17 17 0 0 1 34 0 Z" fill="#C98512" />
              <text x="624" y="265" className="af-eng-lbl" dominantBaseline="middle">
                data + instruction
              </text>
              <text x="904" y="265" className="af-eng-sub" textAnchor="end" dominantBaseline="middle">
                &rarr; both
              </text>
            </g>
            <g fill="none" strokeLinecap="round">
              <path className="af-eng-flow" d="M924 190 H986" stroke="#3E9B4F" strokeWidth="2.4" />
              <path d="M982 185 l8 5 l-8 5 Z" fill="#3E9B4F" stroke="none" />
            </g>
            <g className="af-eng-ansr">
              <circle cx="1044" cy="190" r="36" fill="#3E9B4F" />
              <path
                d="M1029 191 l10 10 l20 -22"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
            <text x="1044" y="250" className="af-eng-nm" textAnchor="middle" fill="#2C7339">
              answer
            </text>
            <text x="580" y="336" className="af-eng-cap" textAnchor="middle">
              The brain thinks · asks a tool · gets{' '}
              <tspan fill="#0A6660" fontWeight="700">
                data
              </tspan>{' '}
              (reason), an{' '}
              <tspan fill="#9A6306" fontWeight="700">
                instruction
              </tspan>{' '}
              (act), or both · loops to the answer.
            </text>
          </svg>
        </div>
      </section>

      {/* ================= ANIMATION 1 — the loop records itself ================= */}
      <section className="af-eng-block" data-narrative="records itself">
        {/* header scrolls past normally — only the animation below pins (the global nav is
            already the sticky header; pinning the section header too is redundant) */}
        <header className="af-eng-ahead">
          <h2 className="af-eng-h2">
            The loop <em>records itself.</em>
          </h2>
          <p className="af-eng-block-lede">
            As the agent runs, every event drains into a typed log &mdash;{' '}
            <b>prompt · ask · return · answer</b> &mdash; with its own cost. Scroll to{' '}
            <b>time-travel</b>
            {' the footprint you’ll later walk backward.'}
          </p>
        </header>
        <div className="af-eng-pin" ref={pinA}>
          <div className="af-eng-sticky">
            {/* shared time-travel transport — sits ABOVE both containers and drives them in
                sync: one scroll position → the arrow flows on the left AND the row appears right */}
            <div className="af-eng-timetravel" aria-hidden="true">
              <div className="af-eng-tt-head">
                <span className="af-eng-live">
                  <span className="af-eng-blink-dot" />
                  recording
                </span>
                <span className="af-eng-tt-step">
                  <span className="rw">{done1 ? '✓ recorded' : '▶ replaying'}</span> step{' '}
                  <b>{Math.max(1, stepNow)}</b> / {totalSteps}
                </span>
                <span className="af-eng-rec-tally">
                  <b>{tally.ms.toLocaleString()}</b> ms · <b>{tally.tok.toLocaleString()}</b> tok ·{' '}
                  <b>{tally.steps}</b> steps
                </span>
              </div>
              <div className="af-eng-scrub-track">
                {Array.from({ length: totalSteps }, (_, i) => (
                  <span key={i} className={`af-eng-scrub-seg${i < stepNow ? ' on' : ''}`} />
                ))}
              </div>
            </div>

            <div className="af-eng-split af-eng-flowwrap">
              {/* LEFT — dedicated flowchart container */}
              <div className="af-eng-exec-card">
                <div className="af-eng-card-head">
                  <span className="af-eng-card-label">execution</span>
                  <span className="af-eng-card-sub">ReAct loop · the hot path</span>
                </div>
                <div className="af-eng-flow-host">
                  <FlowChartView state={state1} emitted={emitted} />
                </div>
              </div>

              {/* RIGHT — dedicated recording container */}
              <div className="af-eng-rec-card">
                <div className="af-eng-rec-head">
                  <span className="af-eng-card-label rec">drain log</span>
                  <span className="af-eng-card-sub">typed footprint · one row per node</span>
                </div>

                <div className="af-eng-rec-log" ref={logScrollRef}>
                  {STEPS.slice(0, emitted).map((s, idx) => {
                    // running 1-based index that skips the loop pseudo-row
                    const nodeNum = STEPS.slice(0, idx + 1).filter((x) => x.kind !== 'loop').length;
                    return (
                      <div key={idx} className={`af-eng-ln ${s.kind}${idx === emitted - 1 ? ' cur' : ''}`}>
                        <span className="af-eng-ln-node">{s.kind === 'loop' ? '↻' : nodeNum}</span>
                        <span className="af-eng-ln-kind">{s.label}</span>
                        <span className="af-eng-ln-txt">{s.text}</span>
                        {s.ms ? (
                          <span className="af-eng-ln-meta">
                            {s.ms}ms · {s.tok}tok
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="af-eng-rec-foot">
                  ↳ logs collect <b>as we run</b> and connect <b>as they execute</b>
                  {' — one row per node, with its own cost. This is the footprint.'}
                </div>
              </div>
            </div>

            <p className="af-eng-rec-phase">
              <span className="a">{capA}</span>
            </p>
          </div>
        </div>
      </section>

      {/* ================= ANIMATION 2 — your agent IS the event loop ================= */}
      <section className="af-eng-block alt2" data-narrative="costs the run nothing">
        {/* header scrolls past; only the animation pins below */}
        <header className="af-eng-ahead">
          <h2 className="af-eng-h2">
            Your agent <em>is</em> the event loop.
          </h2>
          <p className="af-eng-block-lede">
            Same recorded run &mdash; one lens over. A stage runs on the <b>call stack</b>, feeds its
            trace events into the queue; the <b>idle beat</b> flushes them to trace memory and your
            listeners, <b>one beat behind</b>, never blocking the hot path.
          </p>
        </header>
        <div className="af-eng-pin af-eng-pin-wide" ref={pinB}>
          <div className="af-eng-sticky">
            {/* shared transport — drives the flowchart AND the event loop together */}
            <div className="af-eng-timetravel af-eng-timetravel-wide" aria-hidden="true">
              <div className="af-eng-tt-head">
                <span className="af-eng-live">
                  <span className="af-eng-blink-dot" />
                  running
                </span>
                <span className="af-eng-tt-step">
                  <span className="rw">stage</span> <b>{stageName2}</b> · {stepNow2} / {STEPS.length}
                </span>
                <span className="af-eng-rec-tally">your code → call stack → idle-beat flush</span>
              </div>
              <div className="af-eng-scrub-track">
                {Array.from({ length: STEPS.length }, (_, i) => (
                  <span key={i} className={`af-eng-scrub-seg${i < stepNow2 ? ' on' : ''}`} />
                ))}
              </div>
            </div>

            <div className="af-eng-elwrap af-eng-flowwrap">
              {/* LEFT — the SAME flowchart, stepped per stage */}
              <div className="af-eng-exec-card af-eng-el-left">
                <div className="af-eng-card-head">
                  <span className="af-eng-card-label">your code</span>
                  <span className="af-eng-card-sub">the agent · stepping per stage</span>
                </div>
                <div className="af-eng-flow-host">
                  <FlowChartView state={state2} emitted={emitted2} />
                </div>
              </div>

              {/* RIGHT — the browser-engine event loop (SVG), scroll-driven per beat */}
              <div className="af-eng-loop-card af-eng-el-right">
                <div className="af-eng-card-head">
                  <span className="af-eng-card-label hot">the runtime</span>
                  <span className="af-eng-card-sub">the event loop · one beat behind</span>
                </div>
                <EventLoopView prog={progB} />
                <div className="af-eng-rec-foot">
                  ↳ <b>grey</b> is JavaScript&rsquo;s own machinery · <b>green</b> is footprintjs · the
                  watching drains in the <b>idle time</b>, off the hot path. <b>Zero added latency.</b>
                </div>
              </div>
            </div>

            <p className="af-eng-rec-phase">
              <span className="a">{capB}</span>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
