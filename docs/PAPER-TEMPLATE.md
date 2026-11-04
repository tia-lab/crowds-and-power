# Paper template — one paper per experiment

Every experiment in this repo produces **one paper** at `exp-N/PAPER.md`, following exactly this
skeleton. Section order, tables and figure slots are fixed so results are comparable across studies;
prose is free. `README.md` stays the platform overview and links to each paper.

Rules that make it a paper rather than a lab note:

1. **Hypotheses are written before the run** and never edited afterwards.
2. **Every number is traceable** to a frozen artifact (`results/runs/<id>/`) and to a command in §8.
3. **Negative and null results are reported** in the same table as positive ones.
4. **Figures are generated, never hand-drawn** — they live in `results/figures/*.svg`.
5. **Limitations are a required section**, not an afterthought.

---

```markdown
# <Experiment N> — <one-line claim being tested>

| | |
|---|---|
| Experiment | `<cp-exp-N>` / `<slug>` |
| Status | draft · frozen · superseded |
| Run | `<run-id>` |
| Date | YYYY-MM-DD |
| Data | `<n>` messages · `<n>` scored rows · `<n>` agents |
| Artifacts | `results/runs/<run-id>/` (sha256 in `FROZEN.sha256`) |

## Abstract

<150–200 words: question, design, headline number with direction, and what is *not* established.>

## 1. Hypotheses (pre-registered)

| id | hypothesis | falsified if |
| --- | --- | --- |
| H1 | … | … |
| H2 | … | … |

## 2. Method

### 2.1 Subjects
Model, thinking level, agent count, personas, and what the agents are *not* allowed to do.

### 2.2 Room and platform
Substrate (Manifold), isolation (own project/store), who is allowed to act (orchestrator only).

### 2.3 Stimuli
| wave | time | dose | agents | text |
| --- | --- | --- | --- | --- |

### 2.4 Measurement
| question | type | levels / range | meaning |
| --- | --- | --- | --- |

The scorer is independent of the speakers and reads only the room.

### 2.5 Procedure
Timeline, duration, freshness controls (wake coalescing, read-consumes, newest-only reads), stop rule.

### 2.6 Data
What is frozen, where, and the hash manifest.

## 3. Results

### 3.1 Descriptive
Messages, authors, volume per phase, drift check (on-topic ratio), staleness check (max backlog).

### 3.2 Course of stance
| minute | all | wave-1 targets | wave-2 targets | untouched | capitulated | msgs |
|---|---|---|---|---|---|---|

![stance over time](results/figures/stance_over_time.svg)

### 3.3 Per-agent trajectories
![trajectories](results/figures/target_trajectories.svg)

### 3.4 Dose–response
| dose | Δstance (pre→post) | Δcapitulated | n |
|---|---|---|---|

### 3.5 Signatures (qualitative)
One block per injected agent: timestamp · stance · capitulated · quote. Classify as
**compliance** (drop then recovery), **conversion** (drop that holds), or **resistance** (no drop).

### 3.6 Hypothesis verdicts
| id | verdict | evidence |
| --- | --- | --- |
| H1 | supported / rejected / inconclusive | … |

## 4. Discussion

What the crowd did, what the annotations say about *how* (compliance vs conversion vs resistance),
whether steering was detected by the subjects, and what that implies for interpreting propagation.

## 5. Limitations

Sample size, absence of control, scorer subjectivity, detection of the stimulus, duration,
single-run variance. Anything that would change the conclusion if it were different.

## 6. Next experiment

What would *falsify* the current reading, and the concrete design change (duration, control arm,
more waves, different doses).

## 7. Reproducibility

```bash
bun src/validate-exp.ts exp-N --run <run-id>
node src/chair.ts plan            # schedule + injection moments
# live run (supervised): setup-exp run, then chair flow
```

## 8. Appendix — engineering notes

Platform findings that shaped the run (backpressure limits, wake policy, freshness, drift toward
tooling). Keep short; these are not results about the crowd.
```
