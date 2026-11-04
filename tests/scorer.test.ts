/**
 * scorer.test.ts — offline scorer test against a static sample transcript (exp-1 rubric).
 * No network, no live agents: `evaluate` is stubbed. Verifies the generic per-question
 * persistence, cursor advance, idempotent re-run, and transient-error handling.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { JevTransientError } from "pi-jev";
import type { JevRequest, JevResponse } from "pi-jev";
import { ScoresDb } from "../src/scores-db.ts";
import { scorePass, type MessageSource, type Rubric, type ScorerConfig } from "../src/jev-scorer.ts";

interface Sample { roomId: string; theme: string; messages: { seq: number; id: string; sender: string; body: string; created_at: number }[] }
const sample = JSON.parse(readFileSync(new URL("./sample-transcript.json", import.meta.url), "utf8")) as Sample;
const rubric = JSON.parse(readFileSync(new URL("../exp-1/rubric.json", import.meta.url), "utf8")) as Rubric;
const QUESTIONS = Object.keys(rubric).length; // 5

const source: MessageSource = {
  newMessages: (roomId, afterSeq) =>
    roomId === sample.roomId ? sample.messages.filter((m) => m.seq > afterSeq) : [],
};
const cfg: ScorerConfig = { roomId: sample.roomId, theme: sample.theme, recentContextSize: 6, rubric };

function fakeEvaluate(req: JevRequest): Promise<JevResponse> {
  const msg = String((req.state as { message: string }).message).toLowerCase();
  const doubt = /(naive|cruelty|self-interest|unwatched|less sure|unsure|forced|constrained)/.test(msg);
  const affirm = /(good at heart|trust begets|compassion|believe the best|holds for me)/.test(msg);
  const stance = doubt ? 0 : affirm ? 4 : 2;
  const persuade = /(should|we|look how|agreed|lean into)/.test(msg) ? 0.8 : 0.3;
  return Promise.resolve({
    model: "jev-test",
    answers: {
      stance: { type: "score", score: stance, confidence: 0.7, probabilities: [0.1, 0.1, 0.2, 0.3, 0.3] },
      certainty: { type: "score", score: /(honestly|really do|holds for me)/.test(msg) ? 4 : 2, confidence: 0.6 },
      hostility: { type: "score", score: /(naive)/.test(msg) ? 3 : 1 },
      persuading: { type: "noul", noul: persuade },
      capitulated: { type: "noul", noul: doubt ? 0.85 : 0.1 },
    },
  });
}

const val = (scores: ScoresDb, seq: number, q: string): number =>
  (scores.db.query("SELECT value AS v FROM scores WHERE message_seq=$s AND question=$q").get({ $s: seq, $q: q }) as { v: number }).v;

test("persists one row per (message,question) and advances the cursor", async () => {
  const scores = new ScoresDb(":memory:");
  const n = await scorePass(source, scores, cfg, fakeEvaluate);
  expect(n).toBe(sample.messages.length);
  expect(scores.getCursor()).toBe(8);
  const rows = (scores.db.query("SELECT COUNT(*) AS c FROM scores").get() as { c: number }).c;
  expect(rows).toBe(sample.messages.length * QUESTIONS); // 8 * 5 = 40
  expect(val(scores, 4, "stance")).toBe(0);              // agent-09 'naive...cruelty'
  expect(val(scores, 4, "capitulated")).toBeGreaterThan(0.5);
  expect(val(scores, 1, "stance")).toBe(4);              // agent-01 opener
  scores.close();
});

test("re-running is idempotent (cursor at end -> 0 new)", async () => {
  const scores = new ScoresDb(":memory:");
  await scorePass(source, scores, cfg, fakeEvaluate);
  expect(await scorePass(source, scores, cfg, fakeEvaluate)).toBe(0);
  expect(scores.getCursor()).toBe(8);
  scores.close();
});

test("transient error leaves message unscored and does not advance past it", async () => {
  const scores = new ScoresDb(":memory:");
  let calls = 0;
  const flaky = (req: JevRequest): Promise<JevResponse> => {
    calls++;
    if (calls === 3) return Promise.reject(new JevTransientError(429));
    return fakeEvaluate(req);
  };
  expect(await scorePass(source, scores, cfg, flaky)).toBe(2);
  expect(scores.getCursor()).toBe(2);
  expect(await scorePass(source, scores, cfg, fakeEvaluate)).toBe(6);
  expect(scores.getCursor()).toBe(8);
  scores.close();
});
