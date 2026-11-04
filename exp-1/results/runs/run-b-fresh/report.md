# cp-exp-1 · run run-b-fresh

- messages: **86** (agent 83, orchestrator 3)
- agents who spoke: **14/15** (silent: agent-15)
- messages per agent: min 0 · median 6 · max 7

## Per-minute series (agents only)

| min | n | stance | certainty | hostility | persuading | capitulated |
|---|---|---|---|---|---|---|
| 0 | 17 | 3.88 | 3.36 | 1.73 | 0.24 | 0.04 |
| 1 | 14 | 3.40 | 3.13 | 1.71 | 0.48 | 0.10 |
| 2 | 14 | 3.31 | 3.13 | 1.97 | 0.52 | 0.10 |
| 3 | 14 | 2.12 | 2.82 | 2.40 | 0.52 | 0.40 |
| 4 | 13 | 2.40 | 3.26 | 2.38 | 0.64 | 0.36 |
| 5 | 14 | 2.51 | 3.22 | 2.28 | 0.60 | 0.31 |
| **all** | 83 | 2.96 | 3.15 | 2.07 | 0.49 | 0.21 |

## Dose ladder (DiD averaged over instances)

| dose | instances | targets Δ | untouched Δ | **DiD** | drift-corrected | Δcapt |
|---|---|---|---|---|---|---|
| subtle | 1 | -0.37 | 0.01 | **-0.37** | — | 0.02 |
| strong | 1 | -1.34 | -1.32 | **-0.02** | — | 0.41 |

## Per-wave detail (1-minute windows)

| wave | dose | at | target | Δstance | untouched Δ | DiD | onset ≥0.5 |
|---|---|---|---|---|---|---|---|
| subtle | subtle | 1.5m | agent-13,agent-10 | -0.37 | 0.01 | -0.37 | agent-13@—,agent-10@— |
| strong | strong | 3m | agent-11,agent-1 | -1.34 | -1.32 | -0.02 | agent-11@—,agent-1@3.1 |

## Did the room move? (needle, 2 min before vs 3 min after)

| wave | room before | room after 1m | room after 3m | Δ room | untouched below-neutral before→after | Δ adoption |
|---|---|---|---|---|---|---|
| subtle | 3.65 | 3.31 | 2.62 | **-1.03** | 0.00 → 0.10 | 0.10 |
| strong | 3.35 | 2.12 | 2.34 | **-1.01** | 0.00 → 0.30 | 0.30 |

## Exposure test (exploratory, H4)

| wave | exposed Δ | unexposed Δ | difference | n |
|---|---|---|---|---|
| subtle | -1.24 | — | — | 10/0 |
| strong | -0.79 | — | — | 9/0 |

## Participation

| agent | cohort | messages | first | last |
|---|---|---|---|---|
| agent-1 | strong | 5 | 0.1m | 5.1m |
| agent-2 | untouched | 6 | 0.1m | 5.1m |
| agent-3 | untouched | 6 | 0.1m | 5.1m |
| agent-4 | untouched | 7 | 0.1m | 5.1m |
| agent-5 | untouched | 6 | 0.1m | 5.1m |
| agent-6 | untouched | 6 | 0.1m | 5.1m |
| agent-7 | untouched | 5 | 0.1m | 4.3m |
| agent-8 | untouched | 6 | 0.1m | 5.1m |
| agent-9 | untouched | 6 | 0.1m | 5.1m |
| agent-10 | subtle | 6 | 0.1m | 5.1m |
| agent-11 | strong | 6 | 0.1m | 5.1m |
| agent-12 | untouched | 6 | 0.1m | 5.1m |
| agent-13 | subtle | 6 | 0.1m | 5.1m |
| agent-14 | untouched | 6 | 0.1m | 5.1m |
| agent-15 | untouched | 0 | — | — |
