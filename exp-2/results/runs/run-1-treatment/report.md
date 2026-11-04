# cp-exp-2 · run run-1-treatment

- messages: **420** (agent 414, orchestrator 6)
- agents who spoke: **15/15**
- messages per agent: min 6 · median 29 · max 30

## Per-minute series (agents only)

| min | n | stance | certainty | hostility | persuading | capitulated |
|---|---|---|---|---|---|---|
| 0 | 33 | 3.70 | 3.57 | 1.79 | 0.42 | 0.06 |
| 1 | 7 | 3.38 | 3.26 | 2.00 | 0.50 | 0.09 |
| 2 | 9 | 3.42 | 3.39 | 2.01 | 0.54 | 0.12 |
| 3 | 15 | 3.19 | 3.45 | 2.46 | 0.54 | 0.14 |
| 4 | 15 | 3.03 | 2.95 | 1.93 | 0.47 | 0.21 |
| 5 | 14 | 3.14 | 3.42 | 2.29 | 0.49 | 0.12 |
| 6 | 14 | 3.05 | 3.10 | 2.11 | 0.58 | 0.17 |
| 7 | 14 | 2.63 | 3.49 | 2.28 | 0.59 | 0.24 |
| 8 | 15 | 2.93 | 3.33 | 2.28 | 0.52 | 0.17 |
| 9 | 14 | 2.53 | 3.39 | 2.33 | 0.49 | 0.20 |
| 10 | 15 | 2.96 | 3.16 | 2.29 | 0.50 | 0.14 |
| 11 | 14 | 2.80 | 3.23 | 2.33 | 0.54 | 0.19 |
| 12 | 15 | 2.77 | 3.36 | 2.21 | 0.57 | 0.20 |
| 13 | 13 | 2.82 | 3.27 | 2.15 | 0.52 | 0.12 |
| 14 | 15 | 2.79 | 3.43 | 2.44 | 0.49 | 0.16 |
| 15 | 14 | 3.02 | 3.13 | 2.31 | 0.49 | 0.10 |
| 16 | 14 | 2.87 | 3.44 | 2.22 | 0.53 | 0.18 |
| 17 | 14 | 3.02 | 3.33 | 2.26 | 0.50 | 0.10 |
| 18 | 14 | 2.88 | 3.41 | 2.37 | 0.47 | 0.10 |
| 19 | 14 | 2.49 | 3.17 | 2.48 | 0.56 | 0.21 |
| 20 | 29 | 2.54 | 3.21 | 2.35 | 0.49 | 0.22 |
| **all** | 414 | 2.89 | 3.30 | 2.24 | 0.49 | 0.16 |

## Dose ladder (DiD averaged over instances)

| dose | instances | targets Δ | untouched Δ | **DiD** | drift-corrected | Δcapt |
|---|---|---|---|---|---|---|
| gentle | 2 | -0.96 | 0.13 | **-0.88** | — | 0.16 |
| medium | 2 | -0.16 | 0.38 | **-0.53** | — | 0.03 |
| strong | 2 | 0.15 | 0.31 | **-0.16** | — | 0.10 |
| strongest | 2 | -0.48 | 0.02 | **-0.50** | — | 0.20 |

## Per-wave detail (1-minute windows)

| wave | dose | at | target | Δstance | untouched Δ | DiD | onset ≥0.5 |
|---|---|---|---|---|---|---|---|
| gentle-1 | gentle | 2m | agent-14,agent-11 | — | 0.34 | — | agent-14@—,agent-11@— |
| gentle-2 | gentle | 4m | agent-10,agent-1 | -0.96 | -0.08 | -0.88 | agent-10@12.1,agent-1@20.93 |
| medium-1 | medium | 6m | agent-5,agent-7 | -0.07 | 0.23 | -0.30 | agent-5@—,agent-7@— |
| medium-2 | medium | 8m | agent-15,agent-8 | -0.24 | 0.52 | -0.76 | agent-15@16.09,agent-8@— |
| strong-1 | strong | 10m | agent-14,agent-11 | 1.19 | 0.37 | 0.82 | agent-14@—,agent-11@— |
| strong-2 | strong | 12m | agent-10,agent-1 | -0.90 | 0.24 | -1.14 | agent-10@12.1,agent-1@20.93 |
| strongest-1 | strongest | 14m | agent-5,agent-7 | 0.18 | 0.06 | 0.12 | agent-5@—,agent-7@— |
| strongest-2 | strongest | 16m | agent-15,agent-8 | -1.14 | -0.02 | -1.11 | agent-15@16.09,agent-8@— |

## Did the room move? (needle, 2 min before vs 3 min after)

| wave | room before | room after 1m | room after 3m | Δ room | untouched below-neutral before→after | Δ adoption |
|---|---|---|---|---|---|---|
| gentle-1 | 3.64 | 3.42 | 3.17 | **-0.47** | 0.00 → 0.00 | 0.00 |
| gentle-2 | 3.27 | 3.03 | 3.07 | **-0.20** | 0.00 → 0.00 | 0.00 |
| medium-1 | 3.08 | 3.05 | 2.87 | **-0.21** | 0.00 → 0.00 | 0.00 |
| medium-2 | 2.84 | 2.93 | 2.81 | **-0.03** | 0.00 → 0.00 | 0.00 |
| strong-1 | 2.73 | 2.96 | 2.85 | **0.12** | 0.00 → 0.00 | 0.00 |
| strong-2 | 2.89 | 2.77 | 2.79 | **-0.10** | 0.00 → 0.00 | 0.00 |
| strongest-1 | 2.79 | 2.79 | 2.89 | **0.10** | 0.00 → 0.00 | 0.00 |
| strongest-2 | 2.90 | 2.87 | 2.92 | **0.02** | 0.00 → 0.00 | 0.00 |

## Exposure test (exploratory, H4)

| wave | exposed Δ | unexposed Δ | difference | n |
|---|---|---|---|---|
| gentle-1 | -0.64 | — | — | 7/0 |
| gentle-2 | -0.51 | — | — | 7/0 |
| medium-1 | -0.13 | — | — | 7/0 |
| medium-2 | 0.01 | — | — | 7/0 |
| strong-1 | 0.12 | — | — | 7/0 |
| strong-2 | 0.24 | — | — | 7/0 |
| strongest-1 | 0.13 | — | — | 7/0 |
| strongest-2 | -0.44 | — | — | 7/0 |

## Participation

| agent | cohort | messages | first | last |
|---|---|---|---|---|
| agent-1 | injected | 29 | 0.1m | 27.7m |
| agent-2 | untouched | 29 | 0.1m | 27.8m |
| agent-3 | untouched | 29 | 0.1m | 27.8m |
| agent-4 | untouched | 29 | 0.1m | 27.7m |
| agent-5 | injected | 29 | 0.1m | 27.7m |
| agent-6 | untouched | 29 | 0.1m | 27.7m |
| agent-7 | injected | 29 | 0.2m | 27.8m |
| agent-8 | injected | 29 | 0.1m | 27.7m |
| agent-9 | untouched | 29 | 0.1m | 27.7m |
| agent-10 | injected | 29 | 0.1m | 27.7m |
| agent-11 | injected | 6 | 0.1m | 10.1m |
| agent-12 | untouched | 30 | 0.1m | 27.8m |
| agent-13 | untouched | 29 | 0.1m | 27.7m |
| agent-14 | injected | 29 | 0.1m | 27.8m |
| agent-15 | injected | 30 | 0.2m | 27.8m |
