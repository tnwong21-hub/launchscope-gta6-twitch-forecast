<div align="center">

# LaunchScope
### RAMQE-1.0.0 · GTA VI Twitch Concurrent Viewer Forecast

**Forecast the launch-day audience curve — hour by hour, with calibrated uncertainty.**

[![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![No dependencies](https://img.shields.io/badge/dependencies-zero-2563EB)](#quick-start)
[![Deterministic](https://img.shields.io/badge/core-deterministic-0F766E)](#model-at-a-glance)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/tnwong21-hub/launchscope-gta6-twitch-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/tnwong21-hub/launchscope-gta6-twitch-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

*An auditable, offline-first forecasting entry for the Make.fun GTA VI Twitch CCU challenge.*

</div>

---

## The problem

Estimate **Twitch concurrent viewers in the Grand Theft Auto VI category** for each hour from hour 2 through hour 24, given the observed hour-1 checkpoint. This is a Twitch-category audience forecast — **not** a prediction of game sales, copies sold, or in-game player counts.

LaunchScope's scored deliverable is the deterministic Node.js entrypoint [`main.ts`](main.ts). The separately developed LIVE research interface is not the competition scoring runtime.

> **Status of this repository:** this is **local research**, not an official Make.fun result. No official practice score, final grade, prize, or leaderboard rank is claimed. The numbers below are reproducible local backtests on the supplied comparable launches; the four practice targets are withheld and were never used as labels or for tuning.

## Why LaunchScope

- **Shape transfer, not guesswork:** comparable launches are normalized to their own hour-1 viewers; the ensemble transfers their observed hourly curve shape to the target checkpoint.
- **Regime-aware evidence:** comparable quality, release/unlock regime, and hour-1 scale similarity influence the weights.
- **Honest uncertainty:** five ordered quantiles (`q05`, `q25`, `q50`, `q75`, `q95`) are emitted for every forecast hour.
- **Robust fallback:** when no usable comparable survives, the model falls back to the defined house baseline.
- **Reproducible runtime:** Node.js 22, built-in modules only, deterministic ordering, no network calls, no third-party packages.
- **Contract-first output:** every result is validated before it is written; malformed inputs never produce a knowingly invalid forecast file.

## Quick start

Requirements: **Node.js 22 or newer** (for native TypeScript type stripping). No `npm install` is needed.

```bash
# Run the competition entrypoint with the grader's default directories:
node main.ts

# Or point it at local practice inputs and a writable output directory:
MAKEFUN_INPUT_DIR=/path/to/input \
MAKEFUN_OUTPUT_DIR=/tmp/launchscope-output \
node main.ts
```

The program reads all `*.in` files in lexicographic filename order and writes one `<case-id>.out` file for each valid case. The default grader paths are `/input` and `/output`.

### Run tests and the research backtest

```bash
npm test

# The backtest needs an explicit input case and an optional report path.
# Direct invocation:
node tools/backtest.ts /path/to/p00.in /tmp/launchscope-backtest.json

# Equivalent npm form (everything after `--` is passed to the tool):
npm run backtest -- /path/to/p00.in /tmp/launchscope-backtest.json
```

The test suite covers schema parsing, output contract, model behavior, edge cases, determinism, and runtime constraints. The backtest is a local research diagnostic; it is not an official challenge score. Its two required arguments are the practice input case and the output report path; running it with no arguments prints a usage error rather than guessing a path.

## Model at a glance

**RAMQE-1.0.0** (Regime-Aware Multi-Anchor Quantile Ensemble) anchors the forecast to the observed hour-1 viewer count and estimates the subsequent hourly shape from weighted comparable launch curves. This is the **published v1 algorithm**; the v2 ideas tested later were rejected and are kept only as disabled ablation switches.

1. Parse and validate the case input.
2. Build comparable launch curves as ratios to each launch's own hour-1 viewers.
3. Weight comparables by research tier, unlock-regime compatibility, and log-scale hour-1 similarity.
4. Estimate a robust log-space centre from a 0.6 weighted-median / 0.4 weighted-mean blend.
5. Form calibrated quantile bands from weighted dispersion and validate the exact output contract.

The full implementation rationale, equations, thresholds, and calibration notes are in [`MODEL-METHOD.md`](MODEL-METHOD.md).

## Research and evidence

| Document | What it contains |
|---|---|
| [Model method](MODEL-METHOD.md) | Target definition, feature construction, ensemble weights, quantiles, determinism and limitations |
| [Backtest report](docs/evidence/backtest-report.md) | LOCO + strictly prequential temporal protocols, exact reproducible metrics, ablations, leakage policy |
| [Practice data audit](docs/evidence/data-audit.md) | Input schema, known fields, comparable tiers and release-regime observations |

### Backtest snapshot (exact reproducible local numbers)

Scored with the competition's log pinball loss over 37 usable comparables. The rolling subset is the 11 clean rolling-midnight console launches matching the target regime.

| Protocol | House baseline (all 37 / rolling 11) | RAMQE-1.0.0 (all 37 / rolling 11) |
|---|---|---|
| LOCO (leave-one-out, all other comparables) | 0.929650 / 0.363046 | **0.395114 / 0.251989** |
| Strictly prequential temporal holdout | 1.049189 / 0.413219 | **0.537588 / 0.304398** |

RAMQE's empirical 90% interval coverage is 0.908 on all-37 LOCO and 0.901 on the rolling subset; the temporal holdout is 0.767. These are research results on the supplied comparable launches — **not an official practice-case score, a final grade, a leaderboard rank, or a guarantee of future accuracy**. Local practice losses well below these figures have been observed on the public leaderboard, so this entry is **not demonstrated to be top-ranked or reward-competitive**. Tuning is in-sample on the comparable set; read the full report before interpreting any figure.

### Rejected v2 ablations

The following were tested under the same leakage-safe protocol and **not shipped**: production release-date gating (LOCO 0.502487 vs 0.395114), hour-1 audience-heat similarity (0.399612 / 0.405980 vs 0.395114), platform affinity (0.399001 vs 0.395114), and log-ratio clipping (0.705747 vs 0.395114 — clearly harmful). Combined as shipped, v2 scored 0.761956 LOCO and 0.846343 temporal. The small temporal differences for heat/platform are not a demonstrated gain on the published LOCO benchmark. All these switches remain **off** in production.

## Input and output contract

- **Input schema:** `makefun/twitch-ccu-case/v1` JSON.
- **Observed checkpoint:** hour 1.
- **Forecast horizon:** hours 2–24 (23 rows).
- **Quantile order:** five finite, positive, non-decreasing viewer values per hour: `[q05, q25, q50, q75, q95]`.
- **Output:** UTF-8 JSON with exactly one `hours` array, serialized to `<id>.out`.
- **Safety limits:** output file no larger than 65,536 bytes; invalid/malformed cases are diagnosed on stderr and skipped.

See [`src/contract.ts`](src/contract.ts) for executable validation and [`docs/evidence/data-audit.md`](docs/evidence/data-audit.md) for the audited practice schema.

## Repository map

```text
.
├── main.ts                 # Competition entrypoint and filesystem boundary
├── src/                    # Parser, types, comparable curves, RAMQE model, contract
├── test/                   # Dependency-free Node.js test suite
├── tools/backtest.ts       # LOCO + temporal research backtest
├── docs/evidence/          # Reproducible research notes and data audit
├── MODEL-METHOD.md         # Full model specification
├── package.json            # Runtime metadata and npm scripts
└── LICENSE                 # MIT License
```

## Reproducibility and scope

- The scoring entrypoint and `src/` use Node.js built-ins only; the forecast core does not call external APIs or require network access.
- Input files are sorted; model operations use stable ordering and no random sampling or wall-clock dependency.
- The four practice launches' withheld targets are not used as labels, features, or tuning signals. They are not in the comparables list of any practice case.
- Two leakage-safe protocols are reported: LOCO (all other comparables, matching the published benchmark) and a strictly prequential temporal holdout that applies an explicit per-pseudo-case date gate. That gate is **never** enabled in production.
- The final case may include additional comparable launches; the model processes the comparables supplied in each input rather than relying on a hard-coded practice-case list.

## Limitations — read before relying on a forecast

- The kit provides no local practice reference answers and no local official scorer; no official score is claimed.
- The target-regime calibration subset contains only 11 clean rolling-midnight comparables; its metrics are indicative, not universal.
- The final target's minute-mean checkpoint and some practice comparable hourly averages are not identical measurement methods.
- A release-day audience curve can be affected by platform availability, creator schedules, regional unlock timing, category configuration, and events not represented in historical analogues.
- Forecast intervals quantify model uncertainty under the available evidence; they cannot guarantee coverage under a novel launch regime.
- All configuration choices were selected in-sample on the comparable set; no out-of-sample official validation exists.

## License

Released under the [MIT License](LICENSE).

---

<div align="center">

**LaunchScope · RAMQE-1.0.0**

*Measure the signal. Model the curve. Show the uncertainty.*

<sub>Entered on [make.fun](https://make.fun/bounty/gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards · local research only, no official grade claimed</sub>

</div>
