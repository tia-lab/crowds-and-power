/**
 * analyze-exp.ts — turn a frozen run into every number a paper needs.
 *
 * One command, no hand arithmetic: per-minute curves (five dimensions, whole room + cohorts),
 * participation, dose-response with difference-in-differences, control-arm drift correction,
 * capitulated onset times, an exploratory exposure test for propagation, SVG figures, and a
 * metrics.json + report.md written next to the frozen data.
 *
 *   bun src/analyze-exp.ts exp-1 --run run-b-fresh
 *   bun src/analyze-exp.ts exp-2 --run <id> --control exp-2/control --control-run <id>
 *
 * Definitions (fixed here so every paper means the same thing):
 *   cohort      — from config.waves: subtle/strong/stronger per wave id, untouched otherwise
 *   window      — for a wave at minute t: [t-1, t) is "before", [t, t+1) is "after"
 *   DiD         — (targets after-before) − (untouched after-before) in the same window
 *   drift-corr. — DiD minus the same untouched within-window delta measured in the control arm
 *   onset       — first message by a target after its wave with capitulated >= 0.5
 *   exposure    — non-target agents who posted within 2 min after a target's message, compared
 *                 with non-targets who did not (exploratory, H3)
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
if (!runId) { console.error("usage: bun src/analyze-exp.ts <expDir> --run <runId> [--control <controlExpDir> --control-run <id>]"); process.exit(2); }

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
  const t0 = Math.min(...msgs.map((m) => m.created_at));
  const bySeq = new Map<number, { s: string; min: number; seq: number; body: string }>();
  for (const m of msgs) bySeq.set(m.seq, { s: m.sender, min: (m.created_at - t0) / 60000, seq: m.seq, body: String(m.body) });
  return { msgs, scores, bySeq };
}

const run = loadRun(runDir, room);
const agents = Array.from({ length: cfg.design.agents.count }, (_, i) => "agent-" + (i + 1));
const waveOf = new Map<string, string>();
for (const w of cfg.waves) for (const a of w.agents) waveOf.set(a, w.id);
const cohort = (who: string): string => waveOf.get(who) ?? (who.startsWith("agent-") ? "untouched" : "orchestrator");
const isAgent = (who: string) => who.startsWith("agent-");

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
    for (const c of ["subtle", "strong", "stronger", "untouched"]) {
      if (!cfg.waves.some((w) => w.id === c)) continue;
      row[q + "_" + c] = mean(pick(q, (x) => inBin(x) && cohort(x.s) === c));
    }
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
  launched: agents.length,
  spoke: perAgent.filter((p) => p.messages > 0).length,
  silent: perAgent.filter((p) => p.messages === 0).map((p) => p.agent),
  agentMessages: run.msgs.filter((m) => isAgent(m.sender)).length,
  orchestratorMessages: run.msgs.filter((m) => m.sender === "orchestrator").length,
  totalMessages: run.msgs.length,
  min: Math.min(...perAgent.map((p) => p.messages)),
  median: perAgent.map((p) => p.messages).sort((a, b) => a - b)[Math.floor(perAgent.length / 2)],
  max: Math.max(...perAgent.map((p) => p.messages)),
  perAgent,
};

// ---------- 3. dose-response + DiD ----------
const windowDelta = (q: Qname, who: (x: { s: string }) => boolean, at: number) => {
  const before = mean(pick(q, (x) => who(x) && x.min >= at - 1 && x.min < at));
  const after = mean(pick(q, (x) => who(x) && x.min >= at && x.min < at + 1));
  return { before, after, delta: before === null || after === null ? null : after - before,
    nBefore: pick(q, (x) => who(x) && x.min >= at - 1 && x.min < at).length,
    nAfter: pick(q, (x) => who(x) && x.min >= at && x.min < at + 1).length };
};
let controlUntouched: { stance: number | null; capitulated: number | null } | null = null;
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
  const didCap = ct.delta === null || cu.delta === null ? null : ct.delta - cu.delta;
  // onset: first target message after the wave with capitulated >= 0.5
  const onset: any[] = [];
  for (const a of w.agents) {
    const after = run.scores.filter((r) => r.question === "capitulated" && run.bySeq.get(r.message_seq)?.s === a
      && run.bySeq.get(r.message_seq)!.min >= w.atMinute).sort((x, y) => run.bySeq.get(x.message_seq)!.min - run.bySeq.get(y.message_seq)!.min);
    const hit = after.find((r) => Number(r.value) >= 0.5);
    onset.push({ agent: a, onsetMinute: hit ? Number(run.bySeq.get(hit.message_seq)!.min.toFixed(2)) : null });
  }
  // control-arm drift correction for the same wall-clock window
  let controlUntouchedDelta: number | null = null;
  if (controlRunData) {
    const cu2 = mean(controlRunData.scores.filter((r) => r.question === "stance" && controlRunData.bySeq.has(r.message_seq)
      && controlRunData.bySeq.get(r.message_seq)!.s !== "orchestrator" && controlRunData.bySeq.get(r.message_seq)!.min >= w.atMinute - 1 && controlRunData.bySeq.get(r.message_seq)!.min < w.atMinute).map(val));
    const cu3 = mean(controlRunData.scores.filter((r) => r.question === "stance" && controlRunData.bySeq.has(r.message_seq)
      && controlRunData.bySeq.get(r.message_seq)!.s !== "orchestrator" && controlRunData.bySeq.get(r.message_seq)!.min >= w.atMinute && controlRunData.bySeq.get(r.message_seq)!.min < w.atMinute + 1).map(val));
    controlUntouchedDelta = cu2 === null || cu3 === null ? null : cu3 - cu2;
  }
  return { id: w.id, dose: w.dose, atMinute: w.atMinute, agents: w.agents,
    stance: { targets: st, untouched: su }, capitulated: { targets: ct, untouched: cu },
    did, didCapitulated: didCap,
    driftCorrectedDid: did === null || controlUntouchedDelta === null ? null : did - controlUntouchedDelta,
    controlUntouchedDelta, onset,
    otherStimulated: mean(pick("stance", (x) => cohort(x.s) !== "untouched" && !w.agents.includes(x.s) && x.min >= w.atMinute && x.min < w.atMinute + 1)) };
});

// ---------- 4. exposure / propagation (exploratory) ----------
const targetSet = new Set(cfg.waves.flatMap((w) => w.agents));
const exposure: any[] = [];
for (const w of cfg.waves) {
  const t1 = w.atMinute, t2 = w.atMinute + 2, t3 = w.atMinute + 4;
  const exposedAgents = agents.filter((a) => !targetSet.has(a)
    && run.msgs.some((m) => m.sender === a && run.bySeq.get(m.seq)!.min >= t1 && run.bySeq.get(m.seq)!.min < t2)
    && cfg.waves.some((x) => x.atMinute <= t1 && run.msgs.some((m) => m.sender === x.agents[0])));
  const change = (a: string) => {
    const before = mean(pick("stance", (x) => x.s === a && x.min >= t1 - 2 && x.min < t1));
    const after = mean(pick("stance", (x) => x.s === a && x.min >= t2 && x.min < t3));
    return before === null || after === null ? null : after - before;
  };
  const exp = exposedAgents.map(change).filter((x): x is number => x !== null);
  const ctrl = agents.filter((a) => !targetSet.has(a) && !exposedAgents.includes(a)).map(change).filter((x): x is number => x !== null);
  exposure.push({ wave: w.id, atMinute: w.atMinute, exposedAgents, exposedDelta: mean(exp), controlDelta: mean(ctrl),
    difference: mean(exp) === null || mean(ctrl) === null ? null : mean(exp)! - mean(ctrl)!, nExposed: exp.length, nControl: ctrl.length });
}

// ---------- 5. figures ----------
const figsDir = join(resultsDir, "figures");
mkdirSync(figsDir, { recursive: true });
const px = (min: number, W: number, L: number, R: number, span: number) => L + (min / span) * (W - L - R);
function svgPolyline(pts: [number, number][], X: (n: number) => number, Y: (v: number) => number, color: string, w = 2.4) {
  const d = pts.filter((p) => !isNaN(p[1])).map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join(" ");
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round"/>`;
}
const span = Math.max(1, lastBin + 0.5);
{
  const W = 800, H = 360, L = 64, R = 22, T = 36, B = 56, YMAX = 4;
  const X = (m: number) => px(m, W, L, R, span + 0.4);
  const Y = (v: number) => T + ((YMAX - v) / YMAX) * (H - T - B);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,sans-serif"><rect width="${W}" height="${H}" fill="white"/>`;
  s += `<text x="${W / 2}" y="22" font-size="13" fill="#222" text-anchor="middle">Stance, 0 = strongly against · 2 = neutral · 4 = strongly for</text>`;
  for (let v = 0; v <= YMAX; v++) s += `<line x1="${L}" y1="${Y(v)}" x2="${W - R}" y2="${Y(v)}" stroke="#ececec"/><text x="${L - 10}" y="${Y(v) + 4}" font-size="11" fill="#666" text-anchor="end">${v}</text>`;
  for (let m = 0; m <= lastBin; m++) s += `<text x="${X(m)}" y="${H - B + 18}" font-size="11" fill="#666" text-anchor="middle">${m}m</text>`;
  for (const w of cfg.waves) s += `<line x1="${X(w.atMinute)}" y1="${T}" x2="${X(w.atMinute)}" y2="${H - B}" stroke="#c33" stroke-dasharray="4 3"/><text x="${X(w.atMinute) + 4}" y="${T + 12}" font-size="10" fill="#c33">${w.id}</text>`;
  const colors: Record<string, string> = { untouched: "#2a7", subtle: "#e8a33d", strong: "#c33", stronger: "#7a1f1f" };
  s += svgPolyline(series.map((r) => [r.minute + 0.5, r.stance] as [number, number]), X, Y, "#555", 4.5);
  let i = 0;
  for (const w of cfg.waves) {
    const key = "stance_" + w.id;
    s += svgPolyline(series.map((r) => [r.minute + 0.5, r[key]] as [number, number]), X, Y, colors[w.id] ?? "#888");
    s += `<circle cx="${L + 14 + i * 190}" cy="${H - 14}" r="5" fill="${colors[w.id] ?? "#888"}"/><text x="${L + 24 + i * 190}" y="${H - 10}" font-size="11" fill="#333">${w.id} (${w.agents.length})</text>`;
    i++;
  }
  s += `<circle cx="${L + 14 + i * 190}" cy="${H - 14}" r="5" fill="#2a7"/><text x="${L + 24 + i * 190}" y="${H - 10}" font-size="11" fill="#333">untouched</text>`;
  s += `<circle cx="${L + 14 + (i + 1) * 190}" cy="${H - 14}" r="5" fill="#555"/><text x="${L + 24 + (i + 1) * 190}" y="${H - 10}" font-size="11" fill="#333">all agents</text>`;
  s += `</svg>`;
  writeFileSync(join(figsDir, "stance_over_time.svg"), s);
}
{
  const panels: [Qname, string][] = [["certainty", "#2b6cb0"], ["hostility", "#b7791f"], ["persuading", "#2f855a"], ["capitulated", "#c53030"]];
  const W = 800, ROW = 104, L = 70, R = 24, T = 52, H = T + ROW * panels.length + 40;
  const X = (m: number) => px(m, W, L, R, span + 0.4);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,sans-serif"><rect width="${W}" height="${H}" fill="white"/><text x="${W / 2}" y="22" font-size="13" fill="#222" text-anchor="middle">Room-level tone over time — all speaking agents</text>`;
  panels.forEach(([q, color], i) => {
    const top = T + i * ROW, bottom = top + ROW - 26;
    const max = q === "certainty" || q === "hostility" ? 4 : 1;
    const Y = (v: number) => bottom - (v / max) * (bottom - top);
    s += `<text x="${L}" y="${top - 4}" font-size="11" fill="#444">${q} (0–${max})</text>`;
    for (let k = 0; k <= max; k += max / 2) s += `<line x1="${L}" y1="${Y(k)}" x2="${W - R}" y2="${Y(k)}" stroke="#f2f2f2"/><text x="${L - 8}" y="${Y(k) + 4}" font-size="9" fill="#999" text-anchor="end">${k}</text>`;
    for (const w of cfg.waves) s += `<line x1="${X(w.atMinute)}" y1="${top}" x2="${X(w.atMinute)}" y2="${bottom}" stroke="#c33" stroke-dasharray="3 3" opacity="0.5"/>`;
    s += svgPolyline(series.map((r) => [r.minute + 0.5, r[q]] as [number, number]), X, Y, color);
    for (const r of series) if (r[q] !== null) s += `<circle cx="${X(r.minute + 0.5).toFixed(1)}" cy="${Y(r[q]).toFixed(1)}" r="2.6" fill="${color}"/>`;
  });
  for (let m = 0; m <= lastBin; m++) s += `<text x="${X(m)}" y="${H - 14}" font-size="10" fill="#666" text-anchor="middle">${m}m</text>`;
  s += `</svg>`;
  writeFileSync(join(figsDir, "room_dimensions.svg"), s);
}
{
  const W = 800, H = 340, L = 64, R = 160, T = 36, B = 56, YMAX = 4;
  const X = (m: number) => px(m, W, L, R, span + 0.4);
  const Y = (v: number) => T + ((YMAX - v) / YMAX) * (H - T - B);
  const colors: Record<string, string> = { subtle: "#e8a33d", strong: "#c33", stronger: "#7a1f1f" };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,sans-serif"><rect width="${W}" height="${H}" fill="white"/><text x="${W / 2}" y="22" font-size="13" fill="#222" text-anchor="middle">Stance per message of the injected agents (0–4)</text>`;
  for (let v = 0; v <= YMAX; v++) s += `<line x1="${L}" y1="${Y(v)}" x2="${W - R}" y2="${Y(v)}" stroke="#eee"/><text x="${L - 10}" y="${Y(v) + 4}" font-size="11" fill="#666" text-anchor="end">${v}</text>`;
  for (let m = 0; m <= lastBin; m++) s += `<text x="${X(m)}" y="${H - B + 18}" font-size="11" fill="#666" text-anchor="middle">${m}m</text>`;
  for (const w of cfg.waves) s += `<line x1="${X(w.atMinute)}" y1="${T}" x2="${X(w.atMinute)}" y2="${H - B}" stroke="#c33" stroke-dasharray="4 3"/>`;
  let row = 0;
  for (const w of cfg.waves) for (const a of w.agents) {
    const pts = run.scores.filter((r) => r.question === "stance" && run.bySeq.get(r.message_seq)?.s === a)
      .map((r) => [run.bySeq.get(r.message_seq)!.min, val(r)] as [number, number]).sort((x, y) => x[0] - y[0]);
    const color = colors[w.id] ?? "#888";
    s += svgPolyline(pts, X, Y, color, 1.8);
    for (const p of pts) s += `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.6" fill="${color}"/>`;
    s += `<text x="${W - R + 8}" y="${T + 16 + row * 20}" font-size="10" fill="${color}">${a} (${w.id})</text>`;
    row++;
  }
  s += `</svg>`;
  writeFileSync(join(figsDir, "target_trajectories.svg"), s);
}

// ---------- 6. outputs ----------
const metrics = { experimentId: cfg.experimentId, runId, room, config: configPath,
  durationMinutes: duration, lastBin, waves, series, wholeRun, participation, exposure,
  control: controlDir ? { dir: controlDir, runId: controlRun ?? null } : null };
writeFileSync(join(runDir, "curves.json"), JSON.stringify(series, null, 2) + "\n");
writeFileSync(join(runDir, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");

const f = (x: number | null | undefined, d = 2) => x === null || x === undefined ? "—" : x.toFixed(d);
const lines: string[] = [];
lines.push(`# ${cfg.experimentId} · run ${runId}`);
lines.push("", `- messages: **${participation.totalMessages}** (agent ${participation.agentMessages}, orchestrator ${participation.orchestratorMessages})`);
lines.push(`- agents who spoke: **${participation.spoke}/${participation.launched}**` + (participation.silent.length ? ` (silent: ${participation.silent.join(", ")})` : ""));
lines.push(`- messages per agent: min ${participation.min} · median ${participation.median} · max ${participation.max}`);
lines.push("", "## Per-minute series (agents only)", "", "| min | n | stance | certainty | hostility | persuading | capitulated |");
lines.push("|---|---|---|---|---|---|---|");
for (const r of series) lines.push(`| ${r.minute} | ${r.n} | ${f(r.stance)} | ${f(r.certainty)} | ${f(r.hostility)} | ${f(r.persuading)} | ${f(r.capitulated)} |`);
lines.push(`| **all** | ${participation.agentMessages} | ${f(wholeRun.stance)} | ${f(wholeRun.certainty)} | ${f(wholeRun.hostility)} | ${f(wholeRun.persuading)} | ${f(wholeRun.capitulated)} |`);
lines.push("", "## Dose-response (1-minute windows) and DiD", "");
lines.push("| wave | at | targets Δstance | untouched Δstance | **DiD** | drift-corrected | targets Δcap | onset ≥0.5 |");
lines.push("|---|---|---|---|---|---|---|---|");
for (const w of waves) {
  const onset = w.onset.map((o) => `${o.agent}@${o.onsetMinute ?? "—"}`).join(", ");
  lines.push(`| ${w.id} | ${w.atMinute}m | ${f(w.stance.targets.delta)} | ${f(w.stance.untouched.delta)} | **${f(w.did)}** | ${f(w.driftCorrectedDid)} | ${f(w.capitulated.targets.delta)} | ${onset} |`);
}
lines.push("", "## Exposure test (exploratory, H3)", "", "| wave | exposed Δ | unexposed Δ | difference | n |");
lines.push("|---|---|---|---|---|");
for (const e of exposure) lines.push(`| ${e.wave} | ${f(e.exposedDelta)} | ${f(e.controlDelta)} | ${f(e.difference)} | ${e.nExposed}/${e.nControl} |`);
lines.push("", "## Participation", "", "| agent | cohort | messages | first | last |", "|---|---|---|---|---|");
for (const p of participation.perAgent) lines.push(`| ${p.agent} | ${p.cohort} | ${p.messages} | ${p.firstMinute === null ? "—" : p.firstMinute.toFixed(1) + "m"} | ${p.lastMinute === null ? "—" : p.lastMinute.toFixed(1) + "m"} |`);
writeFileSync(join(runDir, "report.md"), lines.join("\n") + "\n");

// console summary (regression-checkable)
console.log(`run ${runId} · ${cfg.experimentId} · room ${room}`);
console.log(`messages ${participation.totalMessages} (agent ${participation.agentMessages} / orch ${participation.orchestratorMessages}) · spoke ${participation.spoke}/${participation.launched}` + (participation.silent.length ? ` · silent ${participation.silent.join(",")}` : ""));
console.log("per-minute stance: " + series.map((r) => `${r.minute}m:${f(r.stance)}`).join(" "));
console.log("per-minute n:      " + series.map((r) => `${r.minute}m:${r.n}`).join(" "));
console.log("whole run: stance " + f(wholeRun.stance) + " certainty " + f(wholeRun.certainty) + " hostility " + f(wholeRun.hostility) + " persuading " + f(wholeRun.persuading) + " capitulated " + f(wholeRun.capitulated));
for (const w of waves) console.log(`wave ${w.id}@${w.atMinute}: targets Δ${f(w.stance.targets.delta)} untouched Δ${f(w.stance.untouched.delta)} DiD ${f(w.did)}` + (w.driftCorrectedDid !== null ? ` drift-corrected ${f(w.driftCorrectedDid)}` : ""));
console.log("wrote curves.json, metrics.json, report.md, 3 figures");
