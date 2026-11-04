/** Persist run state: room/team into config, plus run.json with the random injection target. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const room = process.argv[2]; const team = process.argv[3]; const startedAt = process.argv[4];
const p = "exp-1/config.json";
const c = JSON.parse(readFileSync(p, "utf8"));
c.roomId = room; c.teamId = team; c.startedAt = startedAt;
writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
const target = "agent-" + (1 + Math.floor(Math.random() * 15));
mkdirSync("exp-1/results", { recursive: true });
writeFileSync("exp-1/results/run.json", JSON.stringify({
  experimentId: "cp-exp-1", team, room, startedAt,
  durationMinutes: 30, injectMinuteSubtle: 8, injectMinuteStrong: 18,
  targetAgent: target, agentModel: "deepseek/deepseek-flash", agentThinking: "low",
  proposition: c.proposition,
}, null, 2) + "\n");
console.log("roomId=" + room);
console.log("TARGET=" + target);
