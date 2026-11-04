/**
 * validate-exp.ts — enforce the canonical experiment format (see STUDY.md).
 *
 * Structural checks run without extra dependencies; artifact checks verify a frozen run.
 *
 *   bun src/validate-exp.ts exp-1              # config + protocol conformance
 *   bun src/validate-exp.ts exp-1 --run <id>   # also verify a frozen run directory
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const CORE_QUESTIONS = ["stance", "certainty", "hostility", "persuading", "capitulated"] as const;
const errs: string[] = [];
const warns: string[] = [];
const fail = (m: string) => errs.push(m);
const warn = (m: string) => warns.push(m);

const expDir = resolve(process.argv[2] ?? "exp-1");
const runFlag = process.argv.indexOf("--run");
const runId = runFlag > 0 ? process.argv[runFlag + 1] : undefined;

const cfgPath = join(expDir, "config.json");
if (!existsSync(cfgPath)) { console.error("no config.json in " + expDir); process.exit(2); }
const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as any;

// ---- identity ----
if (cfg.schemaVersion !== 2) fail(`schemaVersion must be 2 (got ${cfg.schemaVersion}); see STUDY.md`);
if (typeof cfg.experimentId !== "string" || !/^cp-[a-z0-9-]+$/.test(cfg.experimentId)) fail("experimentId must match cp-<slug>");
if (!cfg.proposition || String(cfg.proposition).length < 8) fail("proposition missing or too short");
if (!cfg.title) warn("title missing");

// ---- design ----
const d = cfg.design ?? {};
if (!d.agents) fail("design.agents missing"); else {
  if (!(d.agents.count >= 2 && d.agents.count <= 20)) fail("design.agents.count must be 2..20");
  if (!d.agents.model) fail("design.agents.model missing");
  if (!["off","minimal","low","medium","high","xhigh","max"].includes(d.agents.thinking)) fail("design.agents.thinking invalid");
}
if (!(d.durationMinutes > 0 && d.durationMinutes <= 60)) fail("design.durationMinutes must be (0,60]");
if (!["free", "chaired"].includes(d.pacing)) fail("design.pacing must be free|chaired");
if (!Number.isInteger(d.randomSeed)) fail("design.randomSeed is required so target assignment is reproducible");
if (typeof d.control !== "boolean") warn("design.control missing (true for a control arm, false otherwise)");

// ---- waves ----
if (!Array.isArray(cfg.waves)) fail("waves must be an array (empty for a control arm)");
else {
  const ids = new Set<string>();
  const assigned = new Map<string, string>();
  for (const [i, w] of cfg.waves.entries()) {
    const at = `waves[${i}]`;
    if (!w.id || ids.has(w.id)) fail(`${at}.id missing or duplicated`); else ids.add(w.id);
    if (!(w.atMinute >= 0)) fail(`${at}.atMinute must be >= 0`);
    if (typeof d.durationMinutes === "number" && w.atMinute >= d.durationMinutes) fail(`${at}.atMinute is after the run ends`);
    if (!["gentle", "medium", "strong", "strongest", "subtle"].includes(w.dose)) fail(`${at}.dose must be subtle|strong`);
    if (!Array.isArray(w.agents) || w.agents.length === 0) fail(`${at}.agents must name at least one agent`);
    for (const a of w.agents ?? []) {
      if (!/^agent-[0-9]+$/.test(a)) fail(`${at}.agents has an invalid id: ${a}`);
      if (!(Number(a.split("-")[1]) <= d.agents?.count)) fail(`${at}.agents references ${a} beyond agent count`);
      if (assigned.has(a)) fail(`agent ${a} is injected in both ${assigned.get(a)} and ${w.id} (waves must use disjoint agents)`);
      else assigned.set(a, w.id);
    }
    if (!w.text || String(w.text).length < 20) fail(`${at}.text too short`);
  }
  if (cfg.waves.length === 0 && d.control !== true) warn("no waves but design.control is not true");
  if (cfg.waves.length > 0 && d.control === true) warn("waves present but design.control is true");
}

// ---- rubric: the five core questions are mandatory for cross-study comparability ----
const rubricPath = resolve(expDir, cfg.rubric ?? "rubric.json");
if (!existsSync(rubricPath)) fail("rubric file not found: " + rubricPath);
else {
  const rubric = JSON.parse(readFileSync(rubricPath, "utf8")) as any;
  for (const q of CORE_QUESTIONS) {
    if (!rubric[q]) { fail(`rubric is missing the core question '${q}'`); continue; }
    const expected = q === "persuading" || q === "capitulated" ? "noul" : "score";
    if (rubric[q].type !== expected) fail(`rubric['${q}'].type must be ${expected}`);
    if (expected === "score" && !(Array.isArray(rubric[q].criteria) && rubric[q].criteria.length >= 2 && rubric[q].criteria.length <= 10))
      fail(`rubric['${q}'].criteria must list 2..10 ordered levels`);
  }
}

// ---- platform ----
const p = cfg.platform ?? {};
for (const k of ["manifoldRoot", "manifoldDbPath", "scoresDbPath", "resultsDir"]) if (!p[k]) fail(`platform.${k} missing`);
if (p.wakeCoalesceMs === undefined) warn("platform.wakeCoalesceMs not set: an uncoalesced room storms agents with wakes");

// ---- frozen run (optional) ----
if (runId) {
  const runDir = join(expDir, "results/runs", runId);
  if (!existsSync(runDir)) fail("run directory not found: " + runDir);
  else {
    for (const f of ["run.json", "manifold.sqlite", "scores.sqlite", "curves.json", "FROZEN.sha256"])
      if (!existsSync(join(runDir, f))) fail(`run ${runId} is missing ${f}`);
    const figs = join(expDir, "results/figures");
    if (!existsSync(figs) || readdirSync(figs).filter((f) => f.endsWith(".svg")).length === 0)
      fail("results/figures has no SVG figures");
  }
}

for (const w of warns) console.warn("WARN " + w);
if (errs.length) { for (const e of errs) console.error("FAIL " + e); process.exit(1); }
console.log(`OK ${cfg.experimentId}: ${cfg.waves?.length ?? 0} wave(s), ${d.agents?.count} agents, ${d.durationMinutes} min${runId ? `, run ${runId} verified` : ""}`);
