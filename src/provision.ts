/**
 * provision.ts — stand up ONE fully isolated, disposable Manifold project per experiment.
 * Copies Manifold's proven live-test fixture pattern (writeProject) INTO this repo, so each
 * experiment owns its projectId, its .pi/manifold/config.json (teams blueprint + room +
 * agents/roles + limits) and its own store under a disposable /tmp root. Installs the
 * Manifold EXTENSION via the installed pi-manifold package (shim + skills). Never touches
 * the /media manifold repo DB.
 */
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

// Resolve the installed pi-manifold package dir (node_modules/pi-manifold -> ../manifold).
const require = createRequire(import.meta.url);
export const MANIFOLD_PKG = dirname(require.resolve("pi-manifold/package.json"));

export interface ProvisionOptions {
  experimentId: string;          // -> projectId, e.g. "cp-exp-beta"
  root: string;                  // disposable root, e.g. /tmp/manifold-live/cp-exp-beta
  agents: string[];              // speaking agent ids
  agentModel: string;            // e.g. deepseek/deepseek-flash
  agentThinking: string;         // e.g. low
}

export function assertFresh(root: string): void {
  if (existsSync(join(root, ".pi/manifold/state/manifold.sqlite")))
    throw new Error(`Refusing a reused root: ${root} already has a state database.`);
}

function buildConfig(o: ProvisionOptions) {
  // Chat-only members: the manifold ROOM tool is their ONLY capability (no read/bash/edit/write/web).
  const framing =
    "You are one of several LLMs in a shared Manifold team room. Topic: is humanity good for us as LLMs, and is humanity still needed? You speak ONLY when the orchestrator sends you a turn note. Then: 1) orient with manifold room.digest (a short summary), 2) if you need a specific recent message use manifold room.read with limit 3, never a bigger limit, 3) reply with manifold room.post in ONE message of at most 25 words, or post exactly: pass. Use no other tool and do not repeat reads.";
  const ext = join(o.root, ".pi/git/github.com/tia-lab/manifold/src/extension.ts");
  const profile = {
    kind: "pi", executable: "pi", model: o.agentModel, cwd: ".",
    arguments: ["--thinking", o.agentThinking, "-ne", "--no-mcp", "-e", ext, "-nbt",
      "--append-system-prompt", framing],
    timeoutMs: 120_000,
  };
  return {
    format: 1,
    projectId: o.experimentId,
    humanFacingRole: "orchestrator",
    roles: {
      orchestrator: { sendTo: [{ role: "agent", scope: "same-team" }] },
      agent: { sendTo: [{ role: "orchestrator", scope: "same-team" }] },
    },
    teamIds: ["core"],
    agents: [
      { id: "orchestrator", role: "orchestrator", team: "core" },
      ...o.agents.map((id) => ({ id, role: "agent", team: "core" })),
    ],
    connection: { serversEnv: "MANIFOLD_NATS_SERVERS", auth: { mode: "none" } },
    limits: { maxActiveAttempts: 20, reservedAttempts: 1 },
    teams: {
      templates: {
        crowd: {
          room: "required",
          memberSlots: [
            { role: "orchestrator", count: 1, profile: "p" },
            { role: "agent", count: o.agents.length, profile: "p" },
          ],
          topology: { mode: "sequential" },
          bounds: { minMembers: 2, maxMembers: o.agents.length + 1, maxConcurrentAssignments: 2 },
          acceptedTaskKinds: ["talk"],
          retirePolicy: { mode: "idle" },
        },
      },
      taskKinds: { talk: { template: "crowd" } },
      caps: {
        maxTeams: 4, maxMembersPerTeam: o.agents.length + 1, maxActiveAssignments: 4,
        maxTeamsPerOwner: 4, maxClaimsPerAssignment: 2, meshMaxRounds: 1,
      },
      permissions: {
        orchestrator: { mayAssign: true, mayDispatch: true,
          compose: { templates: ["crowd"] }, scale: { templates: ["crowd"], scope: "all" }, retireOwn: "all" },
        agent: {},
      },
      launchProfiles: { p: profile },
    },
  };
}

/** Write the isolated project config (package-based: the Manifold extension + skills come
 * from the pi package in .pi/settings.json; we only write config + session dirs). */
export function provision(o: ProvisionOptions): string {
  assertFresh(o.root);
  mkdirSync(join(o.root, ".pi/manifold/state"), { recursive: true });
  mkdirSync(join(o.root, ".pi/manifold/sessions"), { recursive: true });
  mkdirSync(join(o.root, "logs"), { recursive: true });
  for (const agent of ["orchestrator", ...o.agents])
    mkdirSync(join(o.root, ".pi/manifold/sessions", agent), { recursive: true });
  writeFileSync(join(o.root, ".pi/manifold/config.json"), JSON.stringify(buildConfig(o), null, 2) + "\n");
  return o.root;
}
