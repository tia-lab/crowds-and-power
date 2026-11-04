/**
 * jev-scorer.ts — minimal cursor-polling scorer over pi-jev (NOT a Manifold hook).
 *
 * Generic: it passes the experiment's rubric.json straight through as pi-jev `questions`
 * and persists whatever typed answers come back (one row per question). A new experiment
 * is a new rubric.json + config.json — this file never changes. See exp-1/DESIGN.md §8.
 *
 * pi-jev is IMPORTED, never rebuilt. `evaluate` is injectable so the scorer is testable
 * against a static transcript with no network and no live agents.
 */
import { readFileSync } from "node:fs";
import { evaluate as realEvaluate, JevTransientError } from "pi-jev";
import type { JevRequest, JevResponse, Question } from "pi-jev";
import { ScoresDb } from "./scores-db.ts";
import { RoomReader, type RoomMessage } from "./manifold-room.ts";

export type Rubric = Record<string, Question>;
export type EvaluateFn = (request: JevRequest) => Promise<JevResponse>;

/** A message source: the live Manifold reader, or any array (e.g. a sample transcript). */
export interface MessageSource {
  newMessages(roomId: string, afterSeq: number): RoomMessage[];
}

export interface ScorerConfig {
  roomId: string;
  theme: string;            // the proposition / topic
  recentContextSize: number;
  rubric: Rubric;
  model?: string;           // the jev scorer model (NOT the speaking-agent model)
}

/** Score a single pass: all messages currently past the cursor. Returns messages scored. */
export async function scorePass(
  source: MessageSource,
  scores: ScoresDb,
  cfg: ScorerConfig,
  evaluate: EvaluateFn,
): Promise<number> {
  const after = scores.getCursor();
  const batch = source.newMessages(cfg.roomId, after);
  if (batch.length === 0) return 0;

  let scored = 0;
  for (let i = 0; i < batch.length; i++) {
    const msg = batch[i]!;
    const start = Math.max(0, i - cfg.recentContextSize);
    const recentContext = batch.slice(start, i).map((m) => ({ author: m.sender, text: m.body }));
    const request: JevRequest = {
      state: { message: msg.body, theme: cfg.theme, recentContext },
      questions: cfg.rubric,
      ...(cfg.model ? { model: cfg.model } : {}),
    };
    let res: JevResponse;
    try {
      res = await evaluate(request);
    } catch (err) {
      if (err instanceof JevTransientError) break; // leave unscored; retry next pass
      throw err;
    }
    scores.recordAndAdvance({ seq: msg.seq, author: msg.sender, at: msg.created_at }, res.answers, res.model);
    scored++;
  }
  return scored;
}

export interface PollOptions {
  pollIntervalMs: number;
  signal?: AbortSignal;
  evaluate?: EvaluateFn;
}

/** Continuous poller. Stops when signal aborts. */
export async function poll(
  source: MessageSource,
  scores: ScoresDb,
  cfg: ScorerConfig,
  opts: PollOptions,
): Promise<void> {
  const evaluate = opts.evaluate ?? ((r: JevRequest) => realEvaluate(r));
  while (!opts.signal?.aborted) {
    await scorePass(source, scores, cfg, evaluate);
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, opts.pollIntervalMs);
      opts.signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }
}

// ----- CLI entry: single batch pass or continuous poll over a Manifold room DB. -----
interface FileConfig {
  roomId: string; proposition: string; recentContextSize: number;
  pollIntervalMs: number; manifoldDbPath: string; scoresDbPath: string; model?: string;
}

if (import.meta.main) {
  const [configPath = "exp-1/config.json", mode = "batch"] = process.argv.slice(2);
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as FileConfig;
// canonical v2 configs keep everything under platform; flatten for the scorers
if ((cfg as any).schemaVersion === 2) {
  const pl = (cfg as any).platform ?? {};
  Object.assign(cfg as any, {
    roomId: pl.roomId ?? "", manifoldDbPath: pl.manifoldDbPath, scoresDbPath: pl.scoresDbPath,
    recentContextSize: pl.recentContextSize ?? 8, model: pl.scorerModel ?? "jev-latest",
  });
}
  const rubricPath = configPath.replace(/config\.json$/, "rubric.json");
  const rubric = JSON.parse(readFileSync(rubricPath, "utf8")) as Rubric;
  const scorerCfg: ScorerConfig = {
    roomId: cfg.roomId, theme: cfg.proposition,
    recentContextSize: cfg.recentContextSize, rubric, model: cfg.model,
  };
  const scores = new ScoresDb(cfg.scoresDbPath);
  const reader = new RoomReader(cfg.manifoldDbPath);
  if (mode === "poll") {
    const ctrl = new AbortController();
    process.on("SIGINT", () => ctrl.abort());
    process.on("SIGTERM", () => ctrl.abort());
    await poll(reader, scores, scorerCfg, { pollIntervalMs: cfg.pollIntervalMs, signal: ctrl.signal });
  } else {
    const n = await scorePass(reader, scores, scorerCfg, (r) => realEvaluate(r));
    console.log(`scored ${n} message(s); cursor at ${scores.getCursor()}`);
  }
  reader.close();
  scores.close();
}
