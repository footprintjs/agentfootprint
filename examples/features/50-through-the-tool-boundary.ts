/**
 * 50 — "Why did you say it'll rain?" — answered from INSIDE the tool.
 *
 * Example 49 proved an agent can justify a decision it made last turn by
 * reading the record of that turn. It stopped where every agent trace stops:
 * at the tool boundary. `inspect_tool_call` could say WHICH tool ran, with
 * WHAT arguments, and what came BACK — and then printed the honest wall:
 *
 *     ⚠ boundary: what happened INSIDE the tool is not traced.
 *
 * True for a tool that calls someone else's payments API. Needlessly true
 * for a tool that IS a footprintjs flowchart: that tool recorded every
 * stage it ran, and then threw the recording away, because nobody was
 * holding it.
 *
 * This example holds it. One option — `keepRecord: true` on
 * `flowchartAsTool` — files each invocation's inner record under the
 * `toolCallId` the outer run already uses to name the call. The wall
 * becomes a rung:
 *
 *     inside: this tool kept its own record of the run — 5 step(s), ok.
 *             Descend with inspect_tool_run({ toolCallId: 'c1' }).
 *
 * WHAT THE AGENT ACTUALLY DOES HERE
 * ─────────────────────────────────
 * Turn 1  "Should I bike to work in Chicago tomorrow?"
 *         → one tool call: a 4-stage chart (fetch → validate → decide →
 *           advise) runs inside the tool and comes back with an answer.
 *
 * Turn 2  "Why did you say it'll rain?"
 *         → find_in_trace('rain')            the words → ids
 *         → inspect_tool_call('c1')          the envelope, + the new rung
 *         → inspect_tool_run('c1')           INSIDE: the chart's own overview
 *         → inspect_tool_run('c1', variable) why is `advice` what it is —
 *                                            an inner causal slice, with the
 *                                            decision RULE on the edge
 *         → inspect_tool_run('c1', step,key) the exact field, in full
 *         → an answer that cites an inner stage id and a number.
 *
 * And nothing re-executes. The chart's own stage counters are printed
 * either side of the explanation and are unchanged: the forecast is not
 * fetched twice, and the decision is not re-made to be explained.
 *
 * TWO ID NAMESPACES, ON PURPOSE
 * ─────────────────────────────
 * Inner step ids (`validate-forecast#1`) name steps of the TOOL's chart,
 * not of the agent run that called it. Every `inspect_tool_run` output says
 * so, because a model that pastes an inner id into `trace_node` should get
 * a boundary, not a mystery.
 *
 * DATA
 * ────
 * Mock fixture by DEFAULT — deterministic, $0, no network, CI-safe. Set
 * `AGENTFOOTPRINT_DEMO_LIVE_DATA=1` for a real forecast from Open-Meteo (a
 * keyless public API; no account, no key, no header). The model is a
 * scripted mock unless `ANTHROPIC_API_KEY` is set.
 *
 * Run:
 *   npm run example examples/features/50-through-the-tool-boundary.ts
 *   AGENTFOOTPRINT_DEMO_LIVE_DATA=1 npm run example examples/features/50-…   # real forecast
 *   ANTHROPIC_API_KEY=… npm run example examples/features/50-…              # real model
 *   AGENTFOOTPRINT_DEMO_OFFLINE=1 …                                          # force both mocks
 */

import { decide, flowChart } from 'footprintjs';
import {
  Agent,
  flowchartAsTool,
  type LLMProvider,
  type LLMRequest,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/50-through-the-tool-boundary',
  title: 'Through the tool boundary — the agent explains what happened INSIDE its tool',
  group: 'features',
  description: 'A weather-advice agent whose ONE tool is a footprintjs flowchart wrapped with flowchartAsTool({ keepRecord: true }). Asked "why did you say it will rain?", it descends past the tool boundary with inspect_tool_call to inspect_tool_run and cites the inner stage and the exact field that drove the decision — while the chart stage counters printed either side prove nothing re-executed.',
  defaultInput: 'Should I bike to work in Chicago tomorrow?',
  providerSlots: ['default'],
  tags: ['feature', 'trace', 'self-explain', 'flowchart', 'tools', 'observability'],
};

// ─── The chart the tool wraps. It counts its own stage executions. ────────
//
// This counter is the proof at the bottom of the run: explaining a decision
// must not re-make it. A forecast fetched twice would show up here.

const chartRuns = { fetch: 0, validate: 0, decide: 0, advise: 0 };

interface Forecast {
  readonly city: string;
  readonly day: string;
  readonly precipitationChancePct: number;
  readonly precipitationMm: number;
  readonly windKph: number;
  readonly highTempC: number;
  readonly source: string;
}

interface AdviceState {
  forecast: Forecast;
  /** The one number the decision turns on — hoisted out of the forecast. */
  rainChancePct: number;
  checks: { hasRainChance: boolean; hasWind: boolean; plausible: boolean };
  usable: boolean;
  advice: string;
  because: string;
}

/** The fixture forecast: rainy, deterministic, and obviously synthetic. */
const FIXTURE: Forecast = {
  city: 'Chicago',
  day: 'tomorrow',
  precipitationChancePct: 82,
  precipitationMm: 6.4,
  windKph: 27,
  highTempC: 14,
  source: 'fixture (deterministic demo data — no network)',
};

/** Coordinates for the cities this demo knows. Open-Meteo takes lat/lon. */
const CITIES: Record<string, { lat: number; lon: number; tz: string }> = {
  chicago: { lat: 41.8781, lon: -87.6298, tz: 'America/Chicago' },
};

/**
 * Tomorrow's forecast — fixture by default, Open-Meteo when explicitly
 * enabled. A live call that cannot be made falls back to the fixture and
 * SAYS which one you got in `forecast.source`, so a reader is never left
 * guessing whether the number in front of them came from the sky.
 */
async function getForecast(city: string): Promise<Forecast> {
  const wantsLive =
    process.env.AGENTFOOTPRINT_DEMO_LIVE_DATA === '1' &&
    process.env.AGENTFOOTPRINT_DEMO_OFFLINE !== '1';
  const place = CITIES[city.trim().toLowerCase()];
  if (!wantsLive || !place) {
    return {
      ...FIXTURE,
      city,
      source: wantsLive
        ? `fixture — live data was requested but '${city}' is not in this demo's city table`
        : FIXTURE.source,
    };
  }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    `&daily=precipitation_probability_max,precipitation_sum,wind_speed_10m_max,temperature_2m_max` +
    `&timezone=${encodeURIComponent(place.tz)}&forecast_days=2`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const daily = (await response.json()).daily as Record<string, number[]>;
    return {
      city,
      day: 'tomorrow',
      precipitationChancePct: daily.precipitation_probability_max[1],
      precipitationMm: daily.precipitation_sum[1],
      windKph: daily.wind_speed_10m_max[1],
      highTempC: daily.temperature_2m_max[1],
      source: 'open-meteo.com (live, keyless public API)',
    };
  } catch (e) {
    return {
      ...FIXTURE,
      city,
      source: `fixture — the live forecast could not be fetched (${
        e instanceof Error ? e.message : String(e)
      })`,
    };
  }
}

function buildAdviceChart() {
  return flowChart<AdviceState>(
    'Fetch the forecast',
    async (scope) => {
      chartRuns.fetch += 1;
      const args = scope.$getArgs<{ city: string }>();
      scope.forecast = await getForecast(args.city ?? 'Chicago');
    },
    'fetch-forecast',
  )
    .addFunction(
      'Validate the forecast',
      (scope) => {
        chartRuns.validate += 1;
        const forecast = scope.forecast;
        const checks = {
          hasRainChance: typeof forecast.precipitationChancePct === 'number',
          hasWind: typeof forecast.windKph === 'number',
          plausible:
            forecast.precipitationChancePct >= 0 && forecast.precipitationChancePct <= 100,
        };
        scope.checks = checks;
        scope.usable = checks.hasRainChance && checks.hasWind && checks.plausible;
        // The decisive number, hoisted to its own key so the decision reads
        // one field and a later question can ask about that field by name.
        scope.rainChancePct = forecast.precipitationChancePct;
      },
      'validate-forecast',
      'Check the fields the advice depends on, and hoist the decisive one.',
    )
    .addDeciderFunction(
      'Weigh the rain',
      (scope) => {
        chartRuns.decide += 1;
        return decide(
          scope as unknown as AdviceState,
          [
            {
              when: { usable: { eq: false } },
              then: 'unknown',
              label: 'The forecast failed its checks',
            },
            {
              when: { rainChancePct: { gte: 60 } },
              then: 'rain',
              label: 'Rain chance at or above the 60% bike threshold',
            },
          ],
          'clear',
        );
      },
      'weigh-the-rain',
      'The bike rule: a 60% or greater chance of rain means do not ride.',
    )
    .addFunctionBranch('rain', 'Advise transit', (scope) => {
      chartRuns.advise += 1;
      scope.advice = 'do not bike — take transit';
      scope.because =
        `a ${scope.rainChancePct}% chance of rain (${scope.forecast.precipitationMm}mm) is at or ` +
        `above the 60% threshold`;
    })
    .addFunctionBranch('clear', 'Advise biking', (scope) => {
      chartRuns.advise += 1;
      scope.advice = 'bike';
      scope.because = `only a ${scope.rainChancePct}% chance of rain, below the 60% threshold`;
    })
    .addFunctionBranch('unknown', 'Advise caution', (scope) => {
      chartRuns.advise += 1;
      scope.advice = 'no advice — the forecast did not check out';
      scope.because = 'the forecast was missing fields the rule depends on';
    })
    .end()
    .build();
}

// ─── The tool: one chart, one option ──────────────────────────────────────

function buildAdviceTool() {
  // #region keep-record
  return flowchartAsTool({
    name: 'weather_advice',
    description:
      'Decide whether to bike tomorrow in a given city. Fetches the forecast, validates it, ' +
      'and applies the bike rule. Returns the advice and the reason.',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name, e.g. Chicago' } },
      required: ['city'],
      additionalProperties: false,
    },
    flowchart: buildAdviceChart(),
    // ← THE WHOLE FEATURE. Off by default: a retained record is retained
    //   memory. On, each invocation's inner record is filed under the
    //   outer toolCallId and inspect_tool_run can open it.
    keepRecord: true,
    keepRecordLimit: 10, // bounded, LRU; the default is 20
    resultMapper: (snapshot) => {
      const values = snapshot.values as Partial<AdviceState>;
      return JSON.stringify({ advice: values.advice, because: values.because });
    },
  });
  // #endregion keep-record
}

const POLICY =
  'You are a commuting assistant. Use the weather_advice tool to answer questions about ' +
  'biking, then relay its advice and its reason in one short paragraph.';

// ─── The scripted model, for the $0 deterministic run ─────────────────────

interface Req {
  readonly messages: readonly { role: string; content?: unknown }[];
  readonly tools?: readonly { readonly name: string }[];
}

const catalogOf = (req: Req): string[] => (req.tools ?? []).map((t) => t.name);
const userText = (req: Req): string =>
  String(req.messages.find((m) => m.role === 'user')?.content ?? '');
const lastToolResult = (req: Req): string => {
  const message = [...req.messages].reverse().find((m) => m.role === 'tool');
  return message ? String(message.content ?? '') : '';
};

/**
 * Turn 2's investigation, scripted so the example is reproducible.
 *
 * The sequence is the one the skill teaches, with the new rung in it:
 * locate the subject, open the call, DESCEND, ask the inner run why, then
 * fetch the exact field. Note that the script reads the inner step id out
 * of the previous tool result — the same way a real model does; nothing is
 * hard-coded that the trace did not just print.
 */
function scriptedModel(): LLMProvider {
  return mock({
    chunkDelayMs: 0,
    respond: (req: LLMRequest) => {
      const names = catalogOf(req as Req);
      const asked = userText(req as Req);
      const back = lastToolResult(req as Req);

      // ── TURN 2 — the why-question ─────────────────────────────────
      if (/^why/i.test(asked.trim())) {
        if (names.includes('inspect_tool_run')) {
          if (back.startsWith('FOUND') || back.startsWith('find_in_trace:')) {
            return { toolCalls: [{ id: 'w2', name: 'inspect_tool_call', args: { toolCallId: 'c1' } }] };
          }
          if (back.startsWith('TOOL CALL')) {
            // The "inside:" line said a record exists. Go through it.
            return { toolCalls: [{ id: 'w3', name: 'inspect_tool_run', args: { toolCallId: 'c1' } }] };
          }
          if (back.includes('TRACE RUN OVERVIEW')) {
            // Inside now. Ask the inner run WHY the advice is what it is.
            return {
              toolCalls: [
                { id: 'w4', name: 'inspect_tool_run', args: { toolCallId: 'c1', variable: 'advice' } },
              ],
            };
          }
          if (back.includes("VALUE of 'rainChancePct'")) {
            const value = /VALUE of 'rainChancePct'[^\n]*\n(\S+)/.exec(back)?.[1] ?? '(see above)';
            return {
              content:
                'Because the tool that answered you recorded its own run, and I read it back.\n' +
                'Evidence, from inside tool call c1 (weather_advice):\n' +
                `  • validate-forecast wrote rainChancePct = ${value}, hoisted from the ` +
                'forecast it fetched.\n' +
                '  • weigh-the-rain then took the "rain" branch under the rule "Rain chance at ' +
                'or above the 60% bike threshold".\n' +
                '  • Advise transit wrote the advice you saw.\n' +
                'So "it will rain" is not my recollection — it is that number meeting that rule, ' +
                'in that step.',
            };
          }
          if (back.includes("SLICE for 'advice'")) {
            // The inner slice named the step that hoisted the number, and put
            // the decision RULE on the edge. Now open that exact field.
            const step = /validate-forecast#\d+/.exec(back)?.[0] ?? 'validate-forecast#1';
            return {
              toolCalls: [
                {
                  id: 'w5',
                  name: 'inspect_tool_run',
                  args: { toolCallId: 'c1', runtimeStageId: step, key: 'rainChancePct' },
                },
              ],
            };
          }
          return { toolCalls: [{ id: 'w1', name: 'find_in_trace', args: { query: 'rain' } }] };
        }
        if (names.includes('read_skill')) {
          return { toolCalls: [{ id: 'sk', name: 'read_skill', args: { id: 'self-explain' } }] };
        }
        return { content: 'I have no trace tools available to answer that from.' };
      }

      // ── TURN 1 — the work ─────────────────────────────────────────
      if (!back && names.includes('weather_advice')) {
        return { toolCalls: [{ id: 'c1', name: 'weather_advice', args: { city: 'Chicago' } }] };
      }
      if (back.includes('advice')) {
        const parsed = JSON.parse(back) as { advice: string; because: string };
        return {
          content: `I would not bike tomorrow — ${parsed.because}, so the call is: ${parsed.advice}.`,
        };
      }
      return { content: 'Which city are you commuting in?' };
    },
  });
}

/** Live only when a key is present, the caller injected nothing, and not forced offline. */
async function resolveProvider(
  injected?: LLMProvider,
): Promise<{ provider: LLMProvider; model: string; live: boolean }> {
  if (injected) return { provider: injected, model: 'injected', live: false };
  const offline = process.env.AGENTFOOTPRINT_DEMO_OFFLINE === '1';
  if (offline || !process.env.ANTHROPIC_API_KEY) {
    return { provider: scriptedModel(), model: 'mock-1', live: false };
  }
  const { anthropic } = await import('../../src/doors/providers.js');
  const model = process.env.DEMO_MODEL ?? 'claude-haiku-4-5';
  return { provider: anthropic({ defaultModel: model }), model, live: true };
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  chartRuns.fetch = 0;
  chartRuns.validate = 0;
  chartRuns.decide = 0;
  chartRuns.advise = 0;

  const { provider: llm, model, live } = await resolveProvider(provider);
  const liveData =
    process.env.AGENTFOOTPRINT_DEMO_LIVE_DATA === '1' &&
    process.env.AGENTFOOTPRINT_DEMO_OFFLINE !== '1';
  console.log(
    `model: ${model}${live ? ' (live)' : ' (scripted mock — $0, deterministic)'} · ` +
      `forecast: ${liveData ? 'Open-Meteo (live, keyless)' : 'fixture (no network)'}\n`,
  );

  const agent = Agent.create({
    provider: llm,
    model,
    maxIterations: 10,
    // Ten trace tool definitions land on the tools slot for the one
    // activated iteration. The default 2000-char budget is a SIGNAL, not a
    // limit (nothing is ever truncated) — an agent that opted into
    // .selfExplain() should raise it rather than warn every why-question.
    contextBudget: { tools: 7000 },
  })
    .system(POLICY)
    .tool(buildAdviceTool())
    .selfExplain()
    .build();

  let turn = 1;
  // The descent has to be VISIBLE, not asserted: every trace tool result in
  // turn 2 is printed as the model receives it, so a reader can see the
  // "inside:" rung appear on inspect_tool_call and the inner ids that follow.
  const nameOf = new Map<string, string>();
  agent.on('agentfootprint.stream.tool_start', (event) => {
    nameOf.set(event.payload.toolCallId, event.payload.toolName);
    console.log(`  [turn ${turn}] → ${event.payload.toolName}(${JSON.stringify(event.payload.args)})`);
  });
  agent.on('agentfootprint.stream.tool_end', (event) => {
    const name = nameOf.get(event.payload.toolCallId) ?? '';
    if (turn !== 2 || !name.startsWith('inspect_tool_')) return;
    console.log(
      String(event.payload.result)
        .split('\n')
        .map((line) => `      │ ${line}`)
        .join('\n'),
    );
  });

  // ── TURN 1 — do the work ────────────────────────────────────────────
  console.log('── turn 1 ──────────────────────────────────────────────');
  console.log(`user: ${input}`);
  const first = await agent.run({ message: input });
  console.log(`\nagent: ${typeof first === 'string' ? first : '(paused — unexpected here)'}\n`);
  const afterTurn1 = { ...chartRuns };
  console.log(`inner chart stage executions after turn 1: ${format(afterTurn1)}`);

  // ── TURN 2 — the why-question, answered from INSIDE the tool ────────
  turn = 2;
  const whyQuestion = "Why did you say it'll rain?";
  console.log('\n── turn 2 ──────────────────────────────────────────────');
  console.log(`user: ${whyQuestion}`);
  const second = await agent.run({ message: whyQuestion });
  const answer = typeof second === 'string' ? second : '(paused — unexpected here)';
  console.log(`\nagent: ${answer}\n`);

  // ── THE PROOF ───────────────────────────────────────────────────────
  const afterTurn2 = { ...chartRuns };
  const unchanged = (Object.keys(afterTurn1) as (keyof typeof afterTurn1)[]).every(
    (stage) => afterTurn1[stage] === afterTurn2[stage],
  );
  console.log('── the proof ───────────────────────────────────────────');
  console.log(`inner chart stage executions after turn 2: ${format(afterTurn2)}`);
  console.log(
    `nothing re-executed inside the tool: ${unchanged ? 'YES' : 'NO'} — the forecast was ` +
      `fetched ${afterTurn2.fetch}× across BOTH turns, and the decision was made ` +
      `${afterTurn2.decide}×. The explanation read the record; it did not re-run the chart.`,
  );

  console.log(
    '\nWhat this shows, and what it does not:\n' +
      '  The turn-2 answer descends THROUGH the tool boundary because this tool kept the record\n' +
      '  of its own run (keepRecord: true) — bounded to the last 10 invocations, least-recently\n' +
      '  used dropped first. Without that option the boundary marker stands, and the honest\n' +
      '  answer is the envelope: arguments in, result out.\n' +
      '  The inner ids are the CHART\'s, not the agent run\'s — inspect_tool_run says so on every\n' +
      '  answer, because the two id spaces must never be quietly mixed.\n' +
      '  Redaction still governs what an inner record can serve: footprintjs scrubs at commit\n' +
      '  time, so a key covered by `redact` never enters the inner commit log at all.',
  );

  return answer;
}

/** "fetch 1 · validate 1 · decide 1 · advise 1" */
function format(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([stage, n]) => `${stage} ${n}`)
    .join(' · ');
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
