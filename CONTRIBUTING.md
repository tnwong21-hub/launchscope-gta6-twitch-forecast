# Contributing — LaunchScope / RAMQE-1.0.0

Thanks for your interest in LaunchScope. This repository is a **local research** entry for the
make.fun GTA VI Twitch CCU forecast bounty. It ships the published v1 algorithm (`RAMQE-1.0.0`).
No official Make.fun practice score, final grade, prize, or leaderboard/top-rank claim is made
anywhere in this repository.

## Exact v1 production metrics (local, reproducible)

These are local backtest numbers on the supplied comparable launches, **not** an official grade:

| Protocol | House baseline | RAMQE-1.0.0 (production) |
|---|---|---|
| LOCO, all 37 comparables | 0.929650 | **0.395114** |
| LOCO, rolling 11 subset | 0.363046 | **0.251989** |
| Strictly prequential temporal, all 37 | 1.049189 | **0.537588** |

New candidate variants — audience-heat similarity, platform affinity and a production release-date
gate — were **measured and not selected**; they remain opt-in, off-by-default ablation switches.
Audience `logHeat` is a diagnostic field only. The four practice targets (p00–p03) were **withheld**
and never used as labels, features, or tuning signals. See `docs/evidence/backtest-report.md`.

## Development requirements

- **Node.js 22 or newer** — the source `.ts` files are executed directly via native type stripping;
  the system default `node` on some hosts is v16 and will not run them. Check with `node --version`.
- No third-party runtime dependencies (`npm install` is unnecessary).
- Keep the scoring entrypoint (`main.ts`) deterministic, offline-first and standard-library only.

## Checks before opening a pull request

```bash
npm test

# The research backtest needs explicit arguments; it never guesses a path:
node tools/backtest.ts /path/to/input/p00.in /tmp/launchscope-backtest.json
# Equivalent npm form (args after `--` are forwarded to the tool):
npm run backtest -- /path/to/input/p00.in /tmp/launchscope-backtest.json
# Print the usage reminder without running a backtest:
npm run backtest:help
```

Running the backtest with no arguments prints a usage error rather than picking an arbitrary file.
The backtest is a local research diagnostic, not an official challenge score.

## What to update

- If model assumptions, weighting, calibration or output semantics change: update `MODEL-METHOD.md`,
  `docs/evidence/backtest-report.md` and `docs/evidence/data-audit.md` with exact, reproducible LOCO
  **and** temporal numbers for both the house baseline and production model (never report a
  zero-score baseline). State the protocol, the withheld practice targets, and the limitations.
- Add regression tests for behavior changes. Existing guards pin: `Z` has exactly five elements;
  every runtime `ComparableCurve` carries a finite-or-null `logHeat`; production defaults keep every
  v2 ablation off; and missing/non-finite heat diagnostics never zero the analogue weights.

## Design constraints

- Preserve the exact `makefun/twitch-ccu-case/v1` contract: hours 2–24, five finite positive
  non-decreasing quantiles per hour, output ≤65,536 bytes.
- Keep new heat/platform/date-gate effects off by default; they were not selected into production.
- Never use withheld practice targets or fabricate validation results.
- Keep network access, telemetry, randomness and wall-clock dependencies out of the scoring core.
- Keep diagnostics on stderr; stdout and output files must remain machine-readable.
- Backtests must stay leakage-safe: LOCO forecasts from all *other* comparables (no date gate); the
  temporal holdout applies an explicit per-pseudo-case date gate, never enabled in production.
