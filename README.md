# crowds-and-power

A platform for studying **LLM crowds** — what many language-model agents do when they share one room and
talk to each other at machine speed. Each experiment produces one paper in a fixed format, so results
accumulate instead of scattering.

**Read the first study: [exp-1/PAPER.md](exp-1/PAPER.md)** — *"a doubt planted in two agents moves them, not
the room"*: 15 agents, two doubt waves, 86 messages, 430 typed annotations, frozen with hashes.

## The question

We understand single-agent behaviour reasonably well and almost nothing about crowds: whether a shared
opinion forms, how fast it hardens, and whether a doubt planted in a few agents spreads to the rest.

## How a study works

```
agents (room chat only)  ──▶  Manifold room (durable, ordered)  ──▶  scorer (pi-jev, 5 typed judgments)
        ▲                              │
        └────────── orchestrator ──────┘   seeds the topic, delivers doubt waves, stops the clock
```

- **Agents** can only speak in the room: no files, no shell, no network. Tool-lessness is the safety frame.
- **Manifold** is the substrate: durable messages, fan-out delivery, one isolated project per experiment.
- **The orchestrator** is the only capable component and never takes part in the discussion.
- **The scorer** annotates every message independently on `stance`, `certainty`, `hostility`,
  `persuading`, `capitulated`.

## Format (what every experiment shares)

| artefact | purpose |
|---|---|
| `exp-N/config.json` | the design: agents, duration, waves (who, when, dose, text), rubric, seed |
| `exp-N/rubric.json` | the five typed judgments, passed to the scorer |
| `exp-N/PAPER.md` | the study, in the fixed paper skeleton |
| `exp-N/results/runs/<id>/` | frozen data: room DB, scores DB, curves, figures, sha256 manifest |
| `docs/PAPER-TEMPLATE.md` | the skeleton every paper follows |
| `schema/experiment.schema.json` | machine-readable config contract |

Validate any experiment before and after a run:

```bash
bun src/validate-exp.ts exp-1 --run run-b-fresh
```

## Repository layout

```
src/provision.ts    create an isolated Manifold project for one experiment
src/setup-exp.ts    bind, compose the team+room, launch the agent panes
src/chair.ts        orchestrate: seed, waves, phases, stop     (flow | chaired | plan)
src/jev-scorer.ts   batch scorer over the room
src/live-scorer.ts  watch stance evolve during a run
src/scores-db.ts    scores store + crash-safe cursor
src/manifold-room.ts read-only view of a room
src/validate-exp.ts enforce the experiment format
```

## Quick start

```bash
bun install && bun run check && bun test    # typecheck + offline scorer tests
node src/chair.ts plan                     # schedule + injection moments, zero writes
bun src/validate-exp.ts exp-1              # config conformance
```

A live run launches real agent panes and writes to a real room, so it is a supervised step:
`node src/setup-exp.ts run`, then `node src/chair.ts flow`.

## Status

- **EXP-1: frozen** — see [exp-1/PAPER.md](exp-1/PAPER.md). Dose–response on targets; propagation not
  established (no control arm).
- **EXP-2: pre-registered, not run** — 15 minutes, waves at 5:00 and 10:00, **plus an injection-free control
  arm** so drift can be subtracted from contagion.
