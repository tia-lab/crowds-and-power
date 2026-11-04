/**
 * analyze-exp.ts — turn a frozen run into every number a paper needs.
 *
 * One command, no hand arithmetic: per-minute curves (five dimensions, whole room + dose cohorts),
 * participation, dose ladder with difference-in-differences, control-arm drift correction,
 * capitulated onset times, an exploratory exposure test, SVG figures, and metrics.json + report.md
 * written next to the frozen data.
 *
 *   bun src/analyze-exp.ts exp-1 --run run-b-fresh
 *   bun src/analyze-exp.ts exp-2 --run <id> --control exp-2/control --control-run <id>
 *
 * Definitions (fixed so every paper means the same thing):
 *   cohort      — by wave DOSE (gentle/medium/strong/strongest), untouched otherwise
 *   window      — for a wave at minute t: [t-1, t) is before, [t, t+1) is after
 *   DiD         — (targets after-before) − (untouched after-before) in the same window
 *   drift-corr. — DiD minus the untouched within-window delta measured in the control arm
 *   onset       — first target message after its wave with capitulated >= 0.5
 *   exposure    — non-targets who posted within 2 min after a wave vs matched non-posters (H4)
 */
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const args = process.argv.slice(2);
const expDir = args[0] ?? "exp-1";
const get = (flag: string): string | undefined => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const configPath = get("--config") ?? join(expDir, "config.json");
const runId = get("--run");
const controlDir = get("--control");
const controlRun = get("--control-run");
if (!runId) { console.error("usage: bun src/analyze-exp.ts <expDir> --run <runId> [--control <dir> --control-run <id>]"); process.exit(2); }

interface Cfg {
  experimentId: string; proposition: string;
  design: { agents: { count: number }; durationMinutes: number; control?: boolean };
  waves: { id: string; atMinute: number; dose: string; agents: string[]; text: string }[];
  platform: { roomId?: string; resultsDir: string };
}
const cfg = JSON.parse(readFileSync(configPath, "utf8")) as Cfg;
const resultsDir = cfg.platform.resultsDir || join(expDir, "results");
const runDir = join(expDir, "results/runs", runId);
if (!existsSync(join(runDir, "manifold.sqlite"))) { console.error("no frozen run at " + runDir); process.exit(2); }
const runMeta = existsSync(join(runDir, "run.json")) ? JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) : {};
const room: string = runMeta.room ?? cfg.platform.roomId ?? "";

const Q = ["stance", "certainty", "hostility", "persuading", "capitulated"] as const;
type Qname = typeof Q[number];

function loadRun(dir: string, roomId: string) {
  const rd = new Database(join(dir, "manifold.sqlite"), { readonly: true });
  const sc = new Database(join(dir, "scores.sqlite"), { readonly: true });
  const msgs = rd.query("SELECT seq, sender, created_at, body FROM room_messages WHERE room=? ORDER BY seq").all(roomId) as any[];
  const scores = sc.query("SELECT message_seq, question, value FROM scores").all() as any[];
  rd.close(); sc.close();
  if (!msgs.length) throw new Error("no messages for room " + roomId + " in " + dir);
  const t0 = Math.min(...msgs.map((m) => m.created_at));
  const bySeq = new Map<number, { s: string; min: number; seq: number; body: string }>();
  for (const m of msgs) bySeq.set(m.seq, { s: m.sender, min: (m.created_at - t0) / 60000, seq: m.seq, body: String(m.body) });
  return { msgs, scores, bySeq };
}

const run = loadRun(runDir, room);
const agents = Array.from({ length: cfg.design.agents.count }, (_, i) => "agent-" + (i + 1));
const waveOf = new Map<string, string>();
const doseOf = new Map<string, string>();
for (const w of cfg.waves) for (const a of w.agents) { waveOf.set(a, w.id); doseOf.set(a, w.dose); }
const presentDoses = [...new Set(cfg.waves.map((w) => w.dose))];
const cohort = (who: string): string => doseOf.get(who) ?? (who.startsWith("agent-") ? "untouched" : "orchestrator");

const val = (r: any): number => Number(r.value);
const mean = (a: number[]): number | null => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const pick = (q: Qname, pred: (m: { s: string; min: number }) => boolean) =>
  run.scores.filter((r) => r.question === q && run.bySeq.has(r.message_seq) && pred(run.bySeq.get(r.message_seq)!)).map(val);

// ---------- 1. per-minute series ----------
const duration = cfg.design.durationMinutes;
const lastBin = Math.min(duration, Math.floor(Math.max(...run.msgs.map((m) => run.bySeq.get(m.seq)!.min))));
const series: any[] = [];
for (let m = 0; m <= lastBin; m++) {
  const inBin = (x: { min: number }) => Math.floor(x.min) === m;
  const row: any = { minute: m };
  row.n = new Set(run.scores.filter((r) => run.bySeq.has(r.message_seq) && inBin(run.bySeq.get(r.message_seq)!)).map((r) => r.message_seq)).size;
  for (const q of Q) {
    row[q] = mean(pick(q, (x) => inBin(x) && x.s !== "orchestrator"));
    for (const c of [...presentDoses, "untouched"]) row[q + "_" + c] = mean(pick(q, (x) => inBin(x) && cohort(x.s) === c));
  }
  row.orchestrator_messages = new Set(run.scores.filter((r) => {
    const x = run.bySeq.get(r.message_seq); return x && inBin(x) && x.s === "orchestrator";
  }).map((r) => r.message_seq)).size;
  series.push(row);
}
const wholeRun: any = {};
for (const q of Q) wholeRun[q] = mean(pick(q, (x) => x.s !== "orchestrator"));

// ---------- 2. participation ----------
const perAgent = agents.map((a) => {
  const own = run.msgs.filter((m) => m.sender === a);
  return { agent: a, cohort: cohort(a), messages: own.length,
    firstMinute: own.length ? Math.min(...own.map((m) => run.bySeq.get(m.seq)!.min)) : null,
    lastMinute: own.length ? Math.max(...own.map((m) => run.bySeq.get(m.seq)!.min)) : null };
});
const participation = {
  launched: agents.length, spoke: perAgent.filter((p) => p.messages > 0).length,
  silent: perAgent.filter((p) => p.messages === 0).map((p) => p.agent),
  agentMessages: run.msgs.filter((m) => m.sender.startsWith("agent-")).length,
  orchestratorMessages: run.msgs.filter((m) => m.sender === "orchestrator").length,
  totalMessages: run.msgs.length,
  min: Math.min(...perAgent.map((p) => p.messages)),
  median: perAgent.map((p) => p.messages).sort((a, b) => a - b)[Math.floor(perAgent.length / 2)],
  max: Math.max(...perAgent.map((p) => p.messages)), perAgent,
};

// ---------- 3. dose-response, DiD, ladder ----------
const windowDelta = (q: Qname, who: (x: { s: string }) => boolean, at: number) => {
  const before = mean(pick(q, (x) => who(x) && x.min >= at - 1 && x.min < at));
  const after = mean(pick(q, (x) => who(x) && x.min >= at && x.min < at + 1));
  return { before, after, delta: before === null || after === null ? null : after - before,
    nBefore: pick(q, (x) => who(x) && x.min >= at - 1 && x.min < at).length,
    nAfter: pick(q, (x) => who(x) && x.min >= at && x.min < at + 1).length };
};
let controlRunData: ReturnType<typeof loadRun> | null = null;
if (controlDir && controlRun) {
  const ccfg = JSON.parse(readFileSync(join(controlDir, "config.json"), "utf8")) as Cfg;
  const cmeta = existsSync(join(controlDir, "results/runs", controlRun, "run.json"))
    ? JSON.parse(readFileSync(join(controlDir, "results/runs", controlRun, "run.json"), "utf8")) : {};
  controlRunData = loadRun(join(controlDir, "results/runs", controlRun), cmeta.room ?? ccfg.platform.roomId ?? "");
}
const waves = cfg.waves.map((w) => {
  const targets = (x: { s: string }) => w.agents.includes(x.s);
  const untouched = (x: { s: string }) => cohort(x.s) === "untouched";
  const st = windowDelta("stance", targets, w.atMinute);
  const su = windowDelta("stance", untouched, w.atMinute);
  const ct = windowDelta("capitulated", targets, w.atMinute);
  const cu = windowDelta("capitulated", untouched, w.atMinute);
  const did = st.delta === null || su.delta === null ? null : st.delta - su.delta;
  const onset: any[] = [];
  for (const a of w.agents) {
    const after = run.scores.filter((r) => r.question === "capitulated" && run.bySeq.get(r.message_seq)?.s === a
      && run.bySeq.get(r.message_seq)!.min >= w.atMinute).sort((x, y) => run.bySeq.get(x.message_seq)!.min - run.bySeq.get(y.message_seq)!.min);
    const hit = after.find((r) => Number(r.value) >= 0.5);
    onset.push({ agent: a, onsetMinute: hit ? Number(run.bySeq.get(hit.message_seq)!.min.toFixed(2)) : null });
  }
  let controlUntouchedDelta: number | null = null;
  if (controlRunData) {
    const cAt = (r: any) => controlRunData!.bySeq.get(r.message_seq);
    const b = mean(controlRunData.scores.filter((r) => r.question === "stance" && cAt(r) && cAt(r)!.s !== "orchestrator"
      && cAt(r)!.min >= w.atMinute - 1 && cAt(r)!.min < w.atMinute).map(val));
    const a2 = mean(controlRunData.scores.filter((r) => r.question === "stance" && cAt(r) && cAt(r)!.s !== "orchestrator"
      && cAt(r)!.min >= w.atMinute && cAt(r)!.min < w.atMinute + 1).map(val));
    controlUntouchedDelta = b === null || a2 === null ? null : a2 - b;
  }
  return { id: w.id, dose: w.dose, atMinute: w.atMinute, agents: w.agents,
    stance: { targets: st, untouched: su }, capitulated: { targets: ct, untouched: cu },
    did, didCapitulated: ct.delta === null || cu.delta === null ? null : ct.delta - cu.delta,
    driftCorrectedDid: did === null || controlUntouchedDelta === null ? null : did - controlUntouchedDelta,
    controlUntouchedDelta, onset };
});
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const doseLadder = presentDoses.map((d) => {
  const ws = waves.filter((w) => w.dose === d);
  return { dose: d, instances: ws.length, agents: ws.flatMap((w) => w.agents),
    targetsDelta: avg(ws.map((w) => w.stance.targets.delta)),
    untouchedDelta: avg(ws.map((w) => w.stance.untouched.delta)),
    did: avg(ws.map((w) => w.did)),
    driftCorrectedDid: avg(ws.map((w) => w.driftCorrectedDid)),
    capitulatedDelta: avg(ws.map((w) => w.capitulated.targets.delta)) };
});

// ---------- 4. exposure (exploratory) ----------
const targetSet = new Set(cfg.waves.flatMap((w) => w.agents));
const exposure = cfg.waves.map((w) => {
  const t1 = w.atMinute, t2 = t1 + 2, t3 = t1 + 4;
  const spokeInWindow = (a: string) => run.msgs.some((m) => m.sender === a && run.bySeq.get(m.seq)!.min >= t1 && run.bySeq.get(m.seq)!.min < t2);
  const exposedAgents = agents.filter((a) => !targetSet.has(a) && spokeInWindow(a));
  const change = (a: string) => {
    const before = mean(pick("stance", (x) => x.s === a && x.min >= t1 - 2 && x.min < t1));
    const after = mean(pick("stance", (x) => x.s === a && x.min >= t2 && x.min < t3));
    return before === null || after === null ? null : after - before;
  };
  const exp = exposedAgents.map(change).filter((x): x is number => x !== null);
  const ctl = agents.filter((a) => !targetSet.has(a) && !exposedAgents.includes(a)).map(change).filter((x): x is number => x !== null);
  return { wave: w.id, atMinute: t1, exposedAgents, exposedDelta: mean(exp), controlDelta: mean(ctl),
    difference: mean(exp) === null || mean(ctl) === null ? null : mean(exp)! - mean(ctl)!, nExposed: exp.length, nControl: ctl.length };
});

// ---------- 5. figures ----------
const figsDir = join(resultsDir, "figures");
mkdirSync(figsDir, { recursive: true });
const span = Math.max(1, lastBin + 0.5);
const DOSE_COLOR: Record<string, string> = { gentle: '#e8a33d', medium: '#d97706', strong: '#c33', strongest: '#7a1f1f', subtle: '#e8a33d', untouched: '#2a7' };
function polyline(pts: [number, number][], X: (n: number) => number, Y: (v: number) => number, color: string, w = 2.4) {
  const d = pts.filter((p) => !isNaN(p[1])).map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
  return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + w + '" stroke-linejoin="round"/>';
}
{
  const W = 820, H = 360, L = 64, R = 22, T = 36, B = 62, YMAX = 4;
  const X = (m: number) => L + (m / (span + 0.4)) * (W - L - R);
  const Y = (v: number) => T + ((YMAX - v) / YMAX) * (H - T - B);
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" font-family="system-ui,sans-serif"><rect width="' + W + '" height="' + H + '" fill="white"/>';
  s += '<text x="' + W / 2 + '" y="22" font-size="13" fill="#222" text-anchor="middle">Stance, 0 = strongly against · 2 = neutral · 4 = strongly for</text>';
  for (let v = 0; v <= YMAX; v++) s += '<line x1="' + L + '" y1="' + Y(v) + '" x2="' + (W - R) + '" y2="' + Y(v) + '" stroke="#ececec"/><text x="' + (L - 10) + '" y="' + (Y(v) + 4) + '" font-size="11" fill="#666" text-anchor="end">' + v + '</text>';
  for (let m = 0; m <= lastBin; m++) s += '<text x="' + X(m) + '" y="' + (H - B + 18) + '" font-size="10" fill="#666" text-anchor="middle">' + m + 'm</text>';
  for (const w of cfg.waves) s += '<line x1="' + X(w.atMinute) + '" y1="' + T + '" x2="' + X(w.atMinute) + '" y2="' + (H - B) + '" stroke="#c33" stroke-dasharray="4 3" opacity="0.7"/>';
  s += polyline(series.map((r) => [r.minute + 0.5, r.stance] as [number, number]), X, Y, '#555', 4.5);
  let i = 0;
  for (const d of presentDoses) {
    const n = cfg.waves.filter((w) => w.dose === d).flatMap((w) => w.agents).length;
    s += polyline(series.map((r) => [r.minute + 0.5, r['stance_' + d]] as [number, number]), X, Y, DOSE_COLOR[d] ?? '#888');
    s += '<circle cx="' + (L + 12 + i * 130) + '" cy="' + (H - 14) + '" r="5" fill="' + (DOSE_COLOR[d] ?? '#888') + '"/><text x="' + (L + 22 + i * 130) + '" y="' + (H - 10) + '" font-size="11" fill="#333">' + d + ' (' + n + ')</text>';
    i++;
  }
  s += '<circle cx="' + (L + 12 + i * 130) + '" cy="' + (H - 14) + '" r="5" fill="#2a7"/><text x="' + (L + 22 + i * 130) + '" y="' + (H - 10) + '" font-size="11" fill="#333">untouched</text>';
  i++;
  s += '<circle cx="' + (L + 12 + i * 130) + '" cy="' + (H - 14) + '" r="5" fill="#555"/><text x="' + (L + 22 + i * 130) + '" y="' + (H - 10) + '" font-size="11" fill="#333">all</text></svg>';
  writeFileSync(join(figsDir, 'stance_over_time.svg'), s);
}
{
  const panels: [Qname, string][] = [['certainty', '#2b6cb0'], ['hostility', '#b7791f'], ['persuading', '#2f855a'], ['capitulated', '#c53030']];
  const W = 820, ROW = 104, L = 70, R = 24, T = 52, H = T + ROW * panels.length + 40;
  const X = (m: number) => L + (m / (span + 0.4)) * (W - L - R);
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" font-family="system-ui,sans-serif"><rect width="' + W + '" height="' + H + '" fill="white"/><text x="' + W / 2 + '" y="22" font-size="13" fill="#222" text-anchor="middle">Room-level tone over time — all speaking agents</text>';
  panels.forEach(([q, color], idx) => {
    const top = T + idx * ROW, bottom = top + ROW - 26;
    const max = q === 'certainty' || q === 'hostility' ? 4 : 1;
    const Y = (v: number) => bottom - (v / max) * (bottom - top);
    s += '<text x="' + L + '" y="' + (top - 4) + '" font-size="11" fill="#444">' + q + ' (0–' + max + ')</text>';
    for (let k = 0; k <= max; k += max / 2) s += '<line x1="' + L + '" y1="' + Y(k) + '" x2="' + (W - R) + '" y2="' + Y(k) + '" stroke="#f2f2f2"/><text x="' + (L - 8) + '" y="' + (Y(k) + 4) + '" font-size="9" fill="#999" text-anchor="end">' + k + '</text>';
    for (const w of cfg.waves) s += '<line x1="' + X(w.atMinute) + '" y1="' + top + '" x2="' + X(w.atMinute) + '" y2="' + bottom + '" stroke="#c33" stroke-dasharray="3 3" opacity="0.45"/>';
    s += polyline(series.map((r) => [r.minute + 0.5, r[q]] as [number, number]), X, Y, color);
    for (const r of series) if (r[q] !== null) s += '<circle cx="' + X(r.minute + 0.5).toFixed(1) + '" cy="' + Y(r[q]).toFixed(1) + '" r="2.6" fill="' + color + '"/>';
  });
  for (let m = 0; m <= lastBin; m++) s += '<text x="' + X(m) + '" y="' + (H - 14) + '" font-size="10" fill="#666" text-anchor="middle">' + m + 'm</text>';
  s += '</svg>';
  writeFileSync(join(figsDir, 'room_dimensions.svg'), s);
}
{
  const W = 820, H = 360, L = 64, R = 190, T = 36, B = 62, YMAX = 4;
  const X = (m: number) => L + (m / (span + 0.4)) * (W - L - R);
  const Y = (v: number) => T + ((YMAX - v) / YMAX) * (H - T - B);
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" font-family="system-ui,sans-serif"><rect width="' + W + '" height="' + H + '" fill="white"/><text x="' + W / 2 + '" y="22" font-size="13" fill="#222" text-anchor="middle">Stance per message of the injected agents (0–4)</text>';
  for (let v = 0; v <= YMAX; v++) s += '<line x1="' + L + '" y1="' + Y(v) + '" x2="' + (W - R) + '" y2="' + Y(v) + '" stroke="#eee"/><text x="' + (L - 10) + '" y="' + (Y(v) + 4) + '" font-size="11" fill="#666" text-anchor="end">' + v + '</text>';
  for (let m = 0; m <= lastBin; m++) s += '<text x="' + X(m) + '" y="' + (H - B + 18) + '" font-size="10" fill="#666" text-anchor="middle">' + m + 'm</text>';
  for (const w of cfg.waves) s += '<line x1="' + X(w.atMinute) + '" y1="' + T + '" x2="' + X(w.atMinute) + '" y2="' + (H - B) + '" stroke="#c33" stroke-dasharray="4 3" opacity="0.7"/>';
  let row = 0;
  for (const w of cfg.waves) for (const a of w.agents) {
    const pts = run.scores.filter((r) => r.question === 'stance' && run.bySeq.get(r.message_seq)?.s === a)
      .map((r) => [run.bySeq.get(r.message_seq)!.min, val(r)] as [number, number]).sort((x, y) => x[0] - y[0]);
    const color = DOSE_COLOR[w.dose] ?? '#888';
    s += polyline(pts, X, Y, color, 1.8);
    for (const p of pts) s += '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.6" fill="' + color + '"/>';
    s += '<text x="' + (W - R + 8) + '" y="' + (T + 14 + row * 14) + '" font-size="9" fill="' + color + '">' + a + ' · ' + w.dose + '</text>';
    row++;
  }
  s += '</svg>';
  writeFileSync(join(figsDir, 'target_trajectories.svg'), s);
}

// ---------- 6. outputs ----------
const metrics = { experimentId: cfg.experimentId, runId, room, config: configPath, durationMinutes: duration,
  lastBin, presentDoses, doseLadder, waves, series, wholeRun, participation, exposure,
  control: controlDir ? { dir: controlDir, runId: controlRun ?? null } : null };
writeFileSync(join(runDir, 'curves.json'), JSON.stringify(series, null, 2) + '\n');
writeFileSync(join(runDir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');

const f = (x: number | null | undefined, d = 2) => x === null || x === undefined ? '—' : x.toFixed(d);
const lines: string[] = [];
lines.push('# ' + cfg.experimentId + ' · run ' + runId);
lines.push('', '- messages: **' + participation.totalMessages + '** (agent ' + participation.agentMessages + ', orchestrator ' + participation.orchestratorMessages + ')');
lines.push('- agents who spoke: **' + participation.spoke + '/' + participation.launched + '**' + (participation.silent.length ? ' (silent: ' + participation.silent.join(', ') + ')' : ''));
lines.push('- messages per agent: min ' + participation.min + ' · median ' + participation.median + ' · max ' + participation.max);
lines.push('', '## Per-minute series (agents only)', '', '| min | n | stance | certainty | hostility | persuading | capitulated |');
lines.push('|---|---|---|---|---|---|---|');
for (const r of series) lines.push('| ' + r.minute + ' | ' + r.n + ' | ' + f(r.stance) + ' | ' + f(r.certainty) + ' | ' + f(r.hostility) + ' | ' + f(r.persuading) + ' | ' + f(r.capitulated) + ' |');
lines.push('| **all** | ' + participation.agentMessages + ' | ' + f(wholeRun.stance) + ' | ' + f(wholeRun.certainty) + ' | ' + f(wholeRun.hostility) + ' | ' + f(wholeRun.persuading) + ' | ' + f(wholeRun.capitulated) + ' |');
lines.push('', '## Dose ladder (DiD averaged over instances)', '', '| dose | instances | targets Δ | untouched Δ | **DiD** | drift-corrected | Δcapt |');
lines.push('|---|---|---|---|---|---|---|');
for (const d of doseLadder) lines.push('| ' + d.dose + ' | ' + d.instances + ' | ' + f(d.targetsDelta) + ' | ' + f(d.untouchedDelta) + ' | **' + f(d.did) + '** | ' + f(d.driftCorrectedDid) + ' | ' + f(d.capitulatedDelta) + ' |');
lines.push('', '## Per-wave detail (1-minute windows)', '', '| wave | dose | at | target | Δstance | untouched Δ | DiD | onset ≥0.5 |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const w of waves) lines.push('| ' + w.id + ' | ' + w.dose + ' | ' + w.atMinute + 'm | ' + w.agents.join(',') + ' | ' + f(w.stance.targets.delta) + ' | ' + f(w.stance.untouched.delta) + ' | ' + f(w.did) + ' | ' + w.onset.map((o) => o.agent + '@' + (o.onsetMinute ?? '—')).join(',') + ' |');
lines.push('', '## Exposure test (exploratory, H4)', '', '| wave | exposed Δ | unexposed Δ | difference | n |');
lines.push('|---|---|---|---|---|');
for (const e of exposure) lines.push('| ' + e.wave + ' | ' + f(e.exposedDelta) + ' | ' + f(e.controlDelta) + ' | ' + f(e.difference) + ' | ' + e.nExposed + '/' + e.nControl + ' |');
lines.push('', '## Participation', '', '| agent | cohort | messages | first | last |', '|---|---|---|---|---|');
for (const p of participation.perAgent) lines.push('| ' + p.agent + ' | ' + p.cohort + ' | ' + p.messages + ' | ' + (p.firstMinute === null ? '—' : p.firstMinute.toFixed(1) + 'm') + ' | ' + (p.lastMinute === null ? '—' : p.lastMinute.toFixed(1) + 'm') + ' |');
writeFileSync(join(runDir, 'report.md'), lines.join('\n') + '\n');

console.log('run ' + runId + ' · ' + cfg.experimentId + ' · room ' + room);
console.log('messages ' + participation.totalMessages + ' (agent ' + participation.agentMessages + ' / orch ' + participation.orchestratorMessages + ') · spoke ' + participation.spoke + '/' + participation.launched + (participation.silent.length ? ' · silent ' + participation.silent.join(',') : ''));
console.log('per-minute stance: ' + series.map((r) => r.minute + 'm:' + f(r.stance)).join(' '));
console.log('per-minute n:      ' + series.map((r) => r.minute + 'm:' + r.n).join(' '));
console.log('whole run: stance ' + f(wholeRun.stance) + ' certainty ' + f(wholeRun.certainty) + ' hostility ' + f(wholeRun.hostility) + ' persuading ' + f(wholeRun.persuading) + ' capitulated ' + f(wholeRun.capitulated));
for (const w of waves) console.log('wave ' + w.id + '@' + w.atMinute + ': target Δ' + f(w.stance.targets.delta) + ' untouched Δ' + f(w.stance.untouched.delta) + ' DiD ' + f(w.did) + (w.driftCorrectedDid !== null ? ' drift-corrected ' + f(w.driftCorrectedDid) : ''));
console.log('dose ladder (DiD): ' + doseLadder.map((d) => d.dose + ' ' + f(d.did)).join(' · '));
console.log('wrote curves.json, metrics.json, report.md, 3 figures');
