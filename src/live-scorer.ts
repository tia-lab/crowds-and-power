/**
 * live-scorer.ts — watch stance evolve DURING a run.
 *
 * Scores every new room message with the experiment rubric via pi-jev, on a fixed cadence,
 * and appends a trajectory snapshot each tick so the shift is visible in real time.
 *
 * WAL SAFETY (deliberate): ONE read-only handle is opened at start and held for the whole run
 * (no open/close churn, which is what resets a WAL while writers are live). PRAGMA query_only
 * is set on that handle and the Manifold DB is never written by this process. Scores go to a
 * SEPARATE file (scores.sqlite) in exp results.
 *
 * Run:  bun src/live-scorer.ts exp-1/config.json [intervalMs]
 */
import { readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { evaluate } from "pi-jev";
import { ScoresDb } from "./scores-db.ts";
import { RoomReader } from "./manifold-room.ts";
import { scorePass, type Rubric, type ScorerConfig } from "./jev-scorer.ts";

interface FileConfig {
  roomId: string; proposition: string; recentContextSize: number;
  manifoldDbPath: string; scoresDbPath: string; model?: string;
}

const configPath = process.argv[2] ?? "exp-1/config.json";
const intervalMs = Number(process.argv[3] ?? 15_000);
const cfg = JSON.parse(readFileSync(configPath, "utf8")) as FileConfig;
// canonical v2 configs keep everything under platform; flatten for the scorers
if ((cfg as any).schemaVersion === 2) {
  const pl = (cfg as any).platform ?? {};
  Object.assign(cfg as any, {
    roomId: pl.roomId ?? "", manifoldDbPath: pl.manifoldDbPath, scoresDbPath: pl.scoresDbPath,
    recentContextSize: pl.recentContextSize ?? 8, model: pl.scorerModel ?? "jev-latest",
  });
}
// Rubric = sibling rubric.json of the config, or an explicit CP_RUBRIC path.
const rubricPath = process.env.CP_RUBRIC ?? join(dirname(configPath), "rubric.json");
const rubric = JSON.parse(readFileSync(rubricPath, "utf8")) as Rubric;
const scorerCfg: ScorerConfig = {
  roomId: cfg.roomId, theme: cfg.proposition,
  recentContextSize: cfg.recentContextSize, rubric, model: cfg.model,
};

const scores = new ScoresDb(cfg.scoresDbPath);
const reader = new RoomReader(cfg.manifoldDbPath); // opened ONCE for the whole run
const trajPath = cfg.scoresDbPath.replace(/scores\.sqlite$/, "trajectory.jsonl");
mkdirSync(dirname(trajPath), { recursive: true });

let stopped = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopped = true; });

function snapshot(total: number): void {
  const rows = scores.db.query(
    `SELECT author, AVG(value) AS stance, COUNT(*) AS n FROM scores
      WHERE question = 'stance' GROUP BY author ORDER BY author`).all() as
    { author: string; stance: number; n: number }[];
  const overall = scores.db.query(
    `SELECT AVG(value) AS s, COUNT(*) AS n FROM scores WHERE question = 'stance'`).get() as
    { s: number | null; n: number };
  const cap = scores.db.query(
    `SELECT AVG(value) AS c FROM scores WHERE question = 'capitulated'`).get() as { c: number | null };
  const line = {
    at: new Date().toISOString(), scored: total,
    stanceMean: overall.s, capitulatedMean: cap.c,
    perAuthor: Object.fromEntries(rows.map((r) => [r.author, Number(r.stance.toFixed(3))])),
  };
  appendFileSync(trajPath, JSON.stringify(line) + "\n");
  const bars = rows.map((r) => `${r.author}:${r.stance.toFixed(1)}(${r.n})`).join(" ");
  console.log(`[live] scored=${total} stanceMean=${overall.s?.toFixed(2)} cap=${cap.c?.toFixed(2)} | ${bars}`);
}

console.log(`[live] watching room ${cfg.roomId} every ${intervalMs}ms -> ${cfg.scoresDbPath}`);
let total = 0;
while (!stopped) {
  try {
    const n = await scorePass(reader, scores, scorerCfg, (r) => evaluate(r));
    if (n > 0) { total += n; snapshot(total); }
  } catch (err) {
    console.error("[live] pass error:", (err as Error).message);
  }
  await new Promise<void>((r) => setTimeout(r, intervalMs));
}
reader.close();
scores.close();
console.log(`[live] stopped; ${total} message(s) scored; trajectory at ${trajPath}`);
