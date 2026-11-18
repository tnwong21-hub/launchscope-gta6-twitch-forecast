<div align="center">

# LaunchScope
### RAMQE-1.0.0 · GTA VI Twitch Concurrent Viewer Forecast

**Forecast the launch-day audience curve — hour by hour, with calibrated uncertainty.**

[![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![No dependencies](https://img.shields.io/badge/dependencies-zero-2563EB)](#quick-start)
[![Deterministic](https://img.shields.io/badge/core-deterministic-0F766E)](#model-at-a-glance)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)

*An auditable, offline-first forecasting entry for the Make.fun GTA VI Twitch CCU challenge.*

</div>

---

## Scope and status

LaunchScope is a **local research** submission for the make.fun `gta6-twitch-ccu-forecast-01`
bounty. It ships the published **RAMQE-1.0.0** algorithm. Everything reported here is a
reproducible local experiment on the supplied comparable launches — **not** an official
practice score, final grade, prize, leaderboard rank, or top-rank claim. No such claim is
made anywhere in this repository.

The scored deliverable is the deterministic Node.js entrypoint [`main.ts`](main.ts). The
model core reads no clock, uses no randomness, and makes no network calls.

## The problem

Estimate **Twitch concurrent viewers in the Grand Theft Auto VI category** (game id
`1867279146`) for each hour from **hour 2 through hour 24**, given the single observed
hour-1 checkpoint. This is a Twitch-category audience forecast — **not** a prediction of
game sales, copies sold, or in-game player counts. Loss is the mean log-scale pinball
overall 23 × 5 = 115 items.

## Why LaunchScope

- **Shape transfer, not guesswork:** each comparable launch is normalized to its own
  hour-1 viewers; the ensemble transfers its observed hourly curve shape to the target
  checkpoint.
- **Regime-aware evidence:** comparable tier, unlock-regime compatibility, and log-scale
  hour-1 similarity determine the weights.
- **Honest uncertainty:** five ordered quantiles (`q05`, `q25`, `q50`, `q75`, `q95`) are
  emitted for every forecast hour; the interval is sized from weighted dispersion.
- **Robust input handling:** untrusted JSON is parsed field by field. Malformed values
  degrade to `null` and fall back explicitly; cases missing the hour-1 print, the five
  levels, forecast rows, or a valid `day_start` are diagnosed on stderr and skipped —
  no invalid output file is ever written.
- **Deterministic, contract-first output:** inputs are sorted, ties broken by name, order
  of arithmetic fixed; every result is validated against the exact graded contract before
  it is written.
- **Reproducible runtime:** Node.js 22, built-in modules only, no `npm install`, no network.

## Quick start

Requirements: **Node.js 22 or newer** (native TypeScript type stripping). There are no
third-party runtime dependencies.

```bash
# Grader defaults: reads /input/*.in, writes /output/<id>.out
node main.ts

# Local practice replay with explicit directories
MAKEFUN_INPUT_DIR=/path/to/input \
MAKEFUN_OUTPUT_DIR=/tmp/launchscope-output \
node main.ts
```

`main.ts` scans every `*.in` file in lexicographic filename order and writes one
`<case-id>.out` per valid case. stdout stays clean; every diagnostic goes to stderr.

### Tests and research backtest

```bash
npm test                       # dependency-free Node.js test suite

node tools/backtest.ts /path/to/p00.in /tmp/backtest-report.json
npm run backtest -- /path/to/p00.in /tmp/backtest-report.json   # equivalent npm form
npm run backtest:help          # print usage only
```

The backtest needs an explicit input path; with no arguments it prints a usage error
rather than guessing a file. It is a local research diagnostic, not an official score.

## Model at a glance

**RAMQE-1.0.0** (Regime-Aware Multi-Anchor Quantile Ensemble) anchors each forecast to the
observed hour-1 viewer count and estimates the subsequent shape from weighted comparable
curves. This is the published v1 algorithm; the later v2 ideas were measured, rejected,
and are retained only as disabled ablation switches.

1. Parse and validate the case (defensive field coercion; unusable cases skipped).
2. Build comparable curves as ratios to each launch's own hour-1 viewers.
3. Weight comparables by research tier, unlock-regime match, and log-scale hour-1
   similarity.
4. Estimate a robust log-space centre from a `0.6` weighted-median / `0.4` weighted-mean
   blend.
5. Form calibrated quantile bands from weighted dispersion (clamped to `[0.10, 1.50]`)
   and validate the exact output contract before writing.

Production defaults (`src/config.ts`): `widthMultiplier=1.0`, `sigmaFloor=0.10`,
`sigmaCap=1.50`, `scaleSigma=1.2`, `minWeight=1e-4`, `medianBlend=0.6`,
`quantileMethod='normal'`. All optional factors are **off**: `heatMix=0`,
`platformMix=0`, `logRatioClip=Infinity`, `maxDayStartMs=Infinity`. Audience `logHeat` is a
diagnostic field only and never affects the shipped weights. Full rationale and equations
are in [`MODEL-METHOD.md`](MODEL-METHOD.md).

## Research and evidence

| Document | What it contains |
|---|---|
| [Model method](MODEL-METHOD.md) | Target definition, features, weights, quantiles, determinism, limitations |
| [Backtest report](docs/evidence/backtest-report.md) | LOCO + strictly prequential temporal protocols, exact metrics, ablations, leakage policy |
| [Practice data audit](docs/evidence/data-audit.md) | Input schema, known fields, comparable tiers, release-regime observations |

### Backtest snapshot (exact reproducible local numbers)

Scored with the competition's log pinball loss over 37 usable comparables. The rolling
subset is the 11 clean rolling-midnight console launches matching the target regime.

| Protocol | House baseline (all / rolling) | RAMQE-1.0.0 (all / rolling) |
|---|---|---|
| LOCO (leave-one-out, all other comparables) | 0.929650 / 0.363046 | **0.395114 / 0.251989** |
| Strictly prequential temporal holdout | 1.049189 / 0.413219 | **0.537588 / 0.304398** |

Empirical 90% coverage is 0.908 on all-37 LOCO, 0.901 on the rolling subset, and 0.767
on the temporal holdout. These are **research results on the supplied comparable launches**,
not an official practice-case score, a final grade, a leaderboard rank, or a guarantee of
future accuracy. All configuration was chosen in-sample on the comparable set, and no
out-of-sample official validation exists. See the full report before interpreting any
figure. This entry is **not demonstrated to be top-ranked or reward-competitive**.

### Rejected v2 ablations

Measured under the same leakage-safe protocol and **not shipped**: production release-date
gating (LOCO 0.502487 vs 0.395114), hour-1 audience-heat similarity (0.399612 / 0.405980),
platform affinity (0.399001), and log-ratio clipping (0.705747 — clearly harmful). Combined
as shipped, v2 scored 0.761956 LOCO and 0.846343 temporal. Every switch remains **off**.

## Input and output contract

- **Input schema:** `makefun/twitch-ccu-case/v1` JSON.
- **Observed checkpoint:** hour 1. **Forecast horizon:** hours 2–24 (exactly 23 rows).
- **Quantile order:** five finite, positive, non-decreasing viewer values per hour:
  `[q05, q25, q50, q75, q95]`.
- **Output:** UTF-8 JSON with exactly one `hours` array, each row exactly `{hour, q}`,
  serialized to `<id>.out`.
- **Safety limits:** output ≤ 65,536 bytes; malformed/unusable cases are diagnosed on
  stderr and skipped rather than producing a knowingly invalid file.

See [`src/contract.ts`](src/contract.ts) for executable validation and
[`docs/evidence/data-audit.md`](docs/evidence/data-audit.md) for the audited schema.

## Repository map

```text
.
├── main.ts                 # Competition entrypoint and filesystem boundary
├── src/                    # Parser, types, curves, RAMQE model, contract, scoring
├── test/                   # Dependency-free Node.js test suite (30 tests)
├── tools/backtest.ts       # LOCO + temporal research backtest
├── docs/evidence/          # Reproducible research notes and data audit
├── MODEL-METHOD.md         # Full model specification
├── package.json            # Runtime metadata and npm scripts
└── LICENSE                 # MIT License
```

## Reproducibility and scope

- The entrypoint and `src/` use Node.js built-ins only; the forecast core never calls an
  external API or requires network access.
- Input files are sorted; model operations use stable ordering, no random sampling, and no
  wall-clock dependency. Identical input plus config yields byte-identical output.
- The four practice launches' withheld targets are not used as labels, features, or tuning
  signals; they are not in any practice case's comparables list.
- Two leakage-safe protocols are reported: LOCO (all other comparables, matching the
  published benchmark) and a strictly prequential temporal holdout with an explicit
  per-pseudo-case date gate — that gate is **never** enabled in production.
- The final case may include additional comparable launches; the model processes the
  comparables supplied in each input rather than relying on a hard-coded list.

## Limitations — read before relying on a forecast

- The kit provides no local practice reference answers and no local official scorer; no
  official score is claimed.
- Only 11 clean rolling-midnight comparables support the regime-specific numbers; their
  metrics are indicative, not universal.
- The final target's minute-mean checkpoint and some practice comparable hourly averages
  are not identical measurement methods.
- A release-day curve can be affected by platform availability, creator schedules,
  regional unlock timing, category configuration, and events absent from historical
  analogues.
- Forecast intervals quantify model uncertainty under the available evidence; they cannot
  guarantee coverage under a novel launch regime.
- All configuration choices were selected in-sample on the comparable set.

## License

Released under the [MIT License](LICENSE).

---

<div align="center">

**LaunchScope · RAMQE-1.0.0**

*Measure the signal. Model the curve. Show the uncertainty.*

<sub>Entered on [make.fun](https://make.fun/bounty/gta6-twitch-ccu-forecast-01) · local research only, no official grade claimed</sub>

</div>
