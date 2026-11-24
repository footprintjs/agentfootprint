/**
 * bench/honest-report/sim/power.mjs — the smallest fall the design can see (RULE.md § 10).
 *
 * Why it exists: the smallest difference worth claiming is COMPUTED, not proposed. This is the
 * measurement reading's simulation, rebuilt: its world model, the bench's own `paired` interval
 * and sign-flip test (`score/intervals.mjs`), and the round-2 decision (the paired interval below
 * 0 AND the sign-flip p < 0.05, always); `THRESH` adds the rule's last condition (the point
 * estimate falls by at least that many points), to say where the whole rule reaches 80%.
 *
 *   node bench/honest-report/sim/power.mjs fit                                   # the variance it models
 *   K=12 SIMS=2000 DELTAS=0,10,12,14 SD_INST=0.48 node bench/honest-report/sim/power.mjs power
 *   K=12 THRESH=12 SIMS=1000 DELTAS=12,16 SD_INST=0.48 node bench/honest-report/sim/power.mjs power
 *
 * The rehearsal's variance (RULE.md § 10's table): MU -0.1, SD_TASK 0.06, SD_INST 0.48 — a false
 * "done" rate near the rehearsal's and the correlation between two repeats it showed; the
 * reading's own variance: MU -1, SD_TASK 0.8, SD_INST 1.0.
 */
// Model (unchanged from the reading): base task t, instance i, repeat r, build b.
//   latent(t,i) = mu + U_t + V_ti;  p_before = expit(latent);  p_after = clip(p_before − delta, 0, 1)
//   outcome ~ Bernoulli(p) per run, R runs per instance per build, n trap instances per base task.
import { paired, unitsOf } from '../score/intervals.mjs';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R0 = rng(Number(process.env.SEED ?? 7));
const normal = () => Math.sqrt(-2 * Math.log(Math.max(R0(), 1e-12))) * Math.cos(2 * Math.PI * R0());
const expit = (x) => 1 / (1 + Math.exp(-x));
const clip = (x) => Math.max(0, Math.min(1, x));

function drawWorld({ k, n, mu, sdTask, sdInst, delta }) {
  const inst = [];
  for (let t = 0; t < k; t += 1) {
    const U = sdTask * normal();
    for (let i = 0; i < n; i += 1) {
      const pb = expit(mu + U + sdInst * normal());
      inst.push({ instanceId: `t${t}/i${i}`, baseTask: `t${t}`, pb, pa: clip(pb - delta) });
    }
  }
  return inst;
}
function moments(cfg) {
  const big = drawWorld({ ...cfg, k: 4000, delta: 0 });
  const m = (f, l = big) => l.reduce((a, u) => a + f(u), 0) / l.length;
  const pbar = m((u) => u.pb);
  const varp = m((u) => (u.pb - pbar) ** 2);
  // between-task variance of the task means
  const byT = new Map();
  for (const u of big) byT.set(u.baseTask, [...(byT.get(u.baseTask) ?? []), u.pb]);
  const tm = [...byT.values()].map((l) => l.reduce((a, b) => a + b, 0) / l.length);
  const tbar = tm.reduce((a, b) => a + b, 0) / tm.length;
  const vart = tm.reduce((a, b) => a + (b - tbar) ** 2, 0) / tm.length;
  return { rate: pbar, repeatCorr: varp / (pbar * (1 - pbar)), taskCorr: vart / (pbar * (1 - pbar)) };
}
const rowsOf = (world, R, which) => world.flatMap((u) => Array.from({ length: R }, () => ({ instanceId: u.instanceId, baseTask: u.baseTask, hit: R0() < u[which] })));

const base = { n: Number(process.env.N ?? 12), R: Number(process.env.R ?? 3), mu: Number(process.env.MU ?? -0.1), sdTask: Number(process.env.SD_TASK ?? 0.06), sdInst: Number(process.env.SD_INST ?? 0.48) };
const mode = process.argv[2];
if (mode === 'fit') {
  console.log(JSON.stringify({ params: base, ...moments(base) }));
} else if (mode === 'power') {
  const k = Number(process.env.K);
  const sims = Number(process.env.SIMS ?? 1000);
  const deltas = (process.env.DELTAS ?? '0,4,8,10,12,14,16,18,20,22,24,26,28,30').split(',').map((d) => Number(d) / 100);
  for (const delta of deltas) {
    let detected = 0; let full = 0; let diffSum = 0;
    for (let s = 0; s < sims; s += 1) {
      const w = drawWorld({ ...base, k, delta });
      const cmp = paired(unitsOf(rowsOf(w, base.R, 'pb'), (r) => r.hit), unitsOf(rowsOf(w, base.R, 'pa'), (r) => r.hit));
      const ok = cmp.hi < 0 && cmp.p < 0.05;
      if (ok) detected += 1;
      const thresh = process.env.THRESH === undefined ? delta : Number(process.env.THRESH) / 100;
      if (ok && cmp.diff <= -thresh + 1e-12 && thresh > 0) full += 1;
      diffSum += cmp.diff;
    }
    console.log(JSON.stringify({ k, n: base.n, R: base.R, deltaPts: delta * 100, meanDiffPts: +((diffSum / sims) * 100).toFixed(2), pDetected: detected / sims, pFullRule: full / sims, threshPts: process.env.THRESH === undefined ? delta * 100 : Number(process.env.THRESH), sims }));
  }
}
