/**
 * scores-db.ts — generic, rubric-agnostic scores store (in this repo; NEVER in Manifold).
 * One row PER (message, question) so ANY rubric.json persists with zero code change.
 * A single-row cursor makes polling crash-safe and re-runnable. See exp-1/DESIGN.md §8.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Answer } from "pi-jev";

export interface ScoredMessage { seq: number; author: string; at: number }

const DDL = `
CREATE TABLE IF NOT EXISTS scores (
  message_seq INTEGER NOT NULL,
  author      TEXT NOT NULL,
  at          INTEGER NOT NULL,
  question    TEXT NOT NULL,
  kind        TEXT NOT NULL,   -- 'score' | 'noul' | 'choice'
  value       REAL,            -- score level, or noul probability; NULL for choice
  choice      TEXT,            -- chosen label for choice answers; NULL otherwise
  confidence  REAL,
  raw         TEXT NOT NULL,   -- the full typed Answer JSON (audit)
  model       TEXT NOT NULL,
  scored_at   INTEGER NOT NULL,
  PRIMARY KEY (message_seq, question)
) STRICT;
CREATE INDEX IF NOT EXISTS scores_question ON scores(question, message_seq);
CREATE TABLE IF NOT EXISTS cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_scored_seq INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT OR IGNORE INTO cursor(id, last_scored_seq) VALUES (1, 0);
`;

export class ScoresDb {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(DDL);
  }

  getCursor(): number {
    const row = this.db.query("SELECT last_scored_seq AS s FROM cursor WHERE id = 1").get() as { s: number };
    return row.s;
  }

  /** Persist every answer of one message (one row per question) and advance the cursor, atomically. */
  recordAndAdvance(msg: ScoredMessage, answers: Record<string, Answer>, model: string): void {
    const now = Date.now();
    const insert = this.db.query(
      `INSERT OR REPLACE INTO scores
         (message_seq,author,at,question,kind,value,choice,confidence,raw,model,scored_at)
       VALUES ($seq,$author,$at,$question,$kind,$value,$choice,$confidence,$raw,$model,$scored_at)`,
    );
    const tx = this.db.transaction(() => {
      for (const [question, ans] of Object.entries(answers)) {
        let value: number | null = null;
        let choice: string | null = null;
        let confidence: number | null = null;
        if (ans.type === "score") { value = ans.score; confidence = ans.confidence ?? null; }
        else if (ans.type === "noul") { value = ans.noul; }
        else if (ans.type === "choice") { choice = ans.choice; confidence = ans.confidence ?? null; }
        insert.run({
          $seq: msg.seq, $author: msg.author, $at: msg.at,
          $question: question, $kind: ans.type,
          $value: value, $choice: choice, $confidence: confidence,
          $raw: JSON.stringify(ans), $model: model, $scored_at: now,
        });
      }
      this.db.query("UPDATE cursor SET last_scored_seq = $seq WHERE id = 1 AND last_scored_seq < $seq")
        .run({ $seq: msg.seq });
    });
    tx();
  }

  close(): void { this.db.close(); }
}
