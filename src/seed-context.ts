/**
 * seed-context.ts — give an agent a history it already lived.
 *
 * pi stores each session as a JSONL transcript and accepts `--session <path>` at launch, so a prior can be
 * accumulated context rather than an instruction: the agent opens the room having already reasoned.
 *
 *   bun src/seed-context.ts <out.jsonl> <turns.json>   # [{ user, assistant }, ...]
 *
 * The file is a valid pi session (version 3) with a parentId chain; pi appends the live conversation after it.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

interface Turn { user: string; assistant: string }

const rid = () => randomUUID().replace(/-/g, "").slice(0, 8);

export function seedSession(outPath: string, turns: Turn[], cwd: string, model = "deepseek-flash", provider = "deepseek"): string {
  mkdirSync(dirname(outPath), { recursive: true });
  const id = randomUUID();
  const lines: string[] = [];
  const now = () => new Date().toISOString();
  lines.push(JSON.stringify({ type: "session", version: 3, id, timestamp: now(), cwd }));
  const modelRec = rid(), thinkRec = rid();
  lines.push(JSON.stringify({ type: "model_change", id: modelRec, parentId: null, timestamp: now(), provider, modelId: model }));
  lines.push(JSON.stringify({ type: "thinking_level_change", id: thinkRec, parentId: modelRec, timestamp: now(), thinkingLevel: "low" }));
  let parent: string | null = thinkRec;
  const push = (message: Record<string, unknown>) => {
    const recId = rid();
    lines.push(JSON.stringify({ type: "message", id: recId, parentId: parent, timestamp: now(), message }));
    parent = recId;
  };
  for (const turn of turns) {
    push({ role: "user", content: [{ type: "text", text: turn.user }] });
    push({ role: "assistant", content: [{ type: "text", text: turn.assistant }] });
  }
  writeFileSync(outPath, lines.join("\n") + "\n");
  return outPath;
}

if (import.meta.main) {
  const [out, turnsPath, cwd] = process.argv.slice(2);
  if (!out || !turnsPath) { console.error("usage: seed-context.ts <out.jsonl> <turns.json> [cwd]"); process.exit(2); }
  const turns = JSON.parse(require("node:fs").readFileSync(turnsPath, "utf8")) as Turn[];
  console.log(seedSession(out, turns, cwd ?? process.cwd()));
}
