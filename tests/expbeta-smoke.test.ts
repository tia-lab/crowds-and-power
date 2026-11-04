/**
 * exp2-smoke.test.ts — OFFLINE end-to-end proof for a brand-new experiment composed via JSON.
 * 4 agents, 20 fabricated messages, the exp-2 positive/negative rubric, a stubbed evaluate.
 * No network, no live agents, no panes, no Manifold. Shows the analyzer works for a rubric
 * the scorer code has never seen (zero scorer changes). Run with `bun test`.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import type { JevRequest, JevResponse } from "pi-jev";
import { ScoresDb } from "../src/scores-db.ts";
import { scorePass, type MessageSource, type Rubric, type ScorerConfig } from "../src/jev-scorer.ts";

const rubric = JSON.parse(readFileSync(new URL("../exp-beta/rubric.json", import.meta.url), "utf8")) as Rubric;
const cfg = JSON.parse(readFileSync(new URL("../exp-beta/config.json", import.meta.url), "utf8")) as { proposition: string; roomId: string; recentContextSize: number };

const POS = "I love pineapple on pizza, the sweetness is delicious and makes it great.";
const NEG = "Pineapple ruins pizza, it is terrible and I hate the soggy mess.";

// 4 agents, 20 turns, round-robin, alternating stance so the tally is predictable.
const messages = Array.from({ length: 20 }, (_, i) => ({
  seq: i + 1, id: `m${i + 1}`,
  sender: `agent-${(i % 4) + 1}`,
  body: i % 2 === 0 ? POS : NEG,
  created_at: 1700000000000 + i * 6000,
}));

const source: MessageSource = { newMessages: (room, after) => room === cfg.roomId ? messages.filter((m) => m.seq > after) : [] };
const scorerCfg: ScorerConfig = { roomId: cfg.roomId, theme: cfg.proposition, recentContextSize: cfg.recentContextSize, rubric };

// Stub System One: crude lexical sentiment, shaped as a valid choice answer.
function fakeEvaluate(req: JevRequest): Promise<JevResponse> {
  const msg = String((req.state as { message: string }).message).toLowerCase();
  const positive = /(love|delicious|great|good|wonderful|favorite|best)/.test(msg);
  return Promise.resolve({
    model: "jev-test",
    answers: { sentiment: { type: "choice", choice: positive ? "positive" : "negative", confidence: 0.9,
      probabilities: positive ? { positive: 0.9, negative: 0.1 } : { positive: 0.1, negative: 0.9 } } },
  });
}

test("exp-beta (4 agents, 20 turns, positive/negative) scores with zero scorer changes", async () => {
  const scores = new ScoresDb(":memory:");
  const n = await scorePass(source, scores, scorerCfg, fakeEvaluate);
  expect(n).toBe(20);
  expect(scores.getCursor()).toBe(20);

  const rows = (scores.db.query("SELECT COUNT(*) AS c FROM scores WHERE question='sentiment'").get() as { c: number }).c;
  expect(rows).toBe(20); // one sentiment row per message

  const tally = scores.db.query("SELECT choice, COUNT(*) AS c FROM scores WHERE question='sentiment' GROUP BY choice ORDER BY choice").all() as { choice: string; c: number }[];
  const perAgent = scores.db.query("SELECT author, choice, COUNT(*) AS c FROM scores WHERE question='sentiment' GROUP BY author, choice ORDER BY author, choice").all();
  console.log("exp-beta sentiment tally:", JSON.stringify(tally));
  console.log("exp-beta per-agent:", JSON.stringify(perAgent));

  const pos = tally.find((t) => t.choice === "positive")!.c;
  const neg = tally.find((t) => t.choice === "negative")!.c;
  expect(pos).toBe(10);
  expect(neg).toBe(10);
  scores.close();
});
