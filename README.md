<div align="center">

# LaunchScope
### RAMQE · GTA VI Twitch Concurrent Viewer Forecast

**Forecast the launch-day audience curve — hour by hour, with calibrated uncertainty.**

[![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![No dependencies](https://img.shields.io/badge/dependencies-zero-2563EB)](#quick-start)
[![Deterministic](https://img.shields.io/badge/core-deterministic-0F766E)](#model-at-a-glance)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

*An auditable, offline-first forecasting entry for the Make.fun GTA VI Twitch CCU challenge.*

</div>

---

## The problem

Estimate **Twitch concurrent viewers in the Grand Theft Auto VI category** for each hour from hour 2 through hour 24, given the observed hour-1 checkpoint. This is a Twitch-category audience forecast — **not** a prediction of game sales, copies sold, or in-game player counts.

LaunchScope's scored deliverable is the deterministic Node.js entrypoint [`main.ts`](main.ts). The separately developed LIVE research interface is not the competition scoring runtime.

## Why LaunchScope

- **Shape transfer, not guesswork:** comparable launches are normalized to their own hour-1 viewers; the ensemble transfers their observed hourly curve shape to the target checkpoint.
- **Regime-aware evidence:** comparable quality, release/unlock regime, and hour-1 scale similarity influence the weights.
- **Honest uncertainty:** five ordered quantiles (`q05`, `q25`, `q50`, `q75`, `q95`) are emitted for every forecast hour.
- **Robust fallback:** when no usable comparable survives, the model falls back to the defined house baseline.
- **Reproducible runtime:** Node.js 22, built-in modules only, deterministic ordering, no network calls, no third-party packages.
- **Contract-first output:** every result is validated before it is written; malformed inputs never produce a knowingly invalid forecast file.

## Quick start

Requirements: **Node.js 22 or newer**. No `npm install` is needed.

```bash
# Run the competition entrypoint with the grader's default directories:
node main.ts

# Or point it at local practice inputs and a writable output directory:
MAKEFUN_INPUT_DIR=/path/to/input \
MAKEFUN_OUTPUT_DIR=/tmp/launchscope-output \
node main.ts
```

The program reads all `*.in` files in lexicographic filename order and writes one `<case-id>.out` file for each valid case. The default grader paths are `/input` and `/output`.

### Run tests and research backtest

```bash
node --test test/*.test.mjs
node tools/backtest.ts /path/to/p00.in /tmp/launchscope-backtest.json
```

The test suite covers schema parsing, output contract, model behavior, edge cases, determinism, and runtime constraints. The backtest is a local research diagnostic; it is not an official challenge score.

## Model at a glance

**RAMQE** (Regime-Aware Matched Quantile Ensemble) anchors the forecast to the observed hour-1 viewer count and estimates the subsequent hourly shape from weighted comparable launch curves.

1. Parse and validate the case input.
2. Build comparable launch curves as ratios to each launch's own hour-1 viewers.
3. Weight comparables by research tier, unlock-regime compatibility, and log-scale similarity.
4. Estimate a robust log-space centre from weighted median/mean blend.
5. Form calibrated quantile bands from weighted dispersion and validate the exact output contract.

The full implementation rationale, equations, thresholds, and calibration notes are in [`MODEL-METHOD.md`](MODEL-METHOD.md).

## Research and evidence

| Document | What it contains |
|---|---|
| [Model method](MODEL-METHOD.md) | Target definition, feature construction, ensemble weights, quantiles, determinism and limitations |
| [Backtest report](docs/evidence/backtest-report.md) | Leave-one-comparable-out protocol, benchmark results, ablations and calibration diagnostics |
| [Practice data audit](docs/evidence/data-audit.md) | Input schema, known fields, comparable tiers and release-regime observations |

### Backtest snapshot

On the 11 clean rolling-midnight console comparables, the local LOCO experiment reports **0.252 log-pinball loss** for RAMQE versus **0.363** for the house persistence baseline, with **0.901 empirical 90% interval coverage**. These are research results on the supplied comparable launches — **not an official practice-case score, a final grade, or a guarantee of future accuracy**. The rolling subset is small and tuning is in-sample on the comparable set; read the full report before interpreting the figures.

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
├── tools/backtest.ts       # Leave-one-comparable-out research backtest
├── docs/evidence/          # Reproducible research notes and data audit
├── .github/workflows/      # Automated quality checks
├── MODEL-METHOD.md         # Full model specification
├── package.json            # Runtime metadata and npm scripts
└── LICENSE                 # MIT License
```

## Reproducibility and scope

- The scoring entrypoint and `src/` use Node.js built-ins only; the forecast core does not call external APIs or require network access.
- Input files are sorted; model operations use stable ordering and no random sampling or wall-clock dependency.
- Practice target answers are withheld in the local kit and are not used by the backtest.
- The final case may include additional comparable launches; the model processes the comparables supplied in each input rather than relying on a hard-coded practice-case list.

## Limitations — read before relying on a forecast

- The kit does not provide local practice reference answers or a local official scorer. No official score is claimed here.
- The target-regime calibration subset contains only 11 clean rolling-midnight comparables. Its metrics are indicative, not universal.
- The final target's minute-mean checkpoint and some practice comparable hourly averages are not perfectly identical measurement methods.
- A release-day audience curve can be affected by platform availability, creator schedules, regional unlock timing, category configuration, and events not represented in historical analogues.
- Forecast intervals quantify model uncertainty under the available evidence; they cannot guarantee coverage under a novel launch regime.

## License

Released under the [MIT License](LICENSE).

---

<div align="center">

**LaunchScope · RAMQE**

*Measure the signal. Model the curve. Show the uncertainty.*

</div>
