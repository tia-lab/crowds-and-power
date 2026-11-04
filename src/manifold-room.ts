/**
 * manifold-room.ts — thin helpers over the Manifold SQLite room log.
 *
 * READ path (scorer): opened strictly read-only with PRAGMA query_only=ON. The scorer
 * NEVER mutates Manifold. See exp-1/DESIGN.md §7.
 *
 * WRITE path (trusted writer) lives in relay-runner.ts, not here: this reader module is
 * import-safe for the offline scorer and its test.
 */
import { Database } from "bun:sqlite";

export interface RoomMessage {
  seq: number;
  id: string;
  sender: string;
  body: string;
  created_at: number;
}

/** Open the Manifold DB read-only for scoring. */
export class RoomReader {
  private readonly db: Database;

  constructor(manifoldDbPath: string) {
    this.db = new Database(manifoldDbPath, { readonly: true });
    // Belt-and-braces: even if opened writable elsewhere, forbid writes on this handle.
    this.db.exec("PRAGMA query_only = ON;");
  }

  /** New messages in room with seq strictly greater than the cursor, oldest first. */
  newMessages(roomId: string, afterSeq: number): RoomMessage[] {
    return this.db
      .query(
        `SELECT seq, id, COALESCE(correlation, sender) AS sender, body, created_at
           FROM room_messages
          WHERE room = $room AND seq > $after
          ORDER BY seq ASC`,
      )
      .all({ $room: roomId, $after: afterSeq }) as RoomMessage[];
  }

  close(): void {
    this.db.close();
  }
}
