# RAMQE-1.0.0 — Model Method Note (LaunchScope)

Version `RAMQE-1.0.0`, the published v1 algorithm. Standard library only, deterministic,
no network. This note is the auditable description of the code in `src/`. It is **local
research**, not an official Make.fun result; no official practice score, grade, rank, or
prize is claimed.

## Target and framing

The scored quantity is Twitch's **concurrent viewers in the GTA VI category** (game id
`1867279146`) — not game players, sales, or console CCU. Only hour 1's print `p1` is
observed at the checkpoint. We must produce five quantiles for each of hours 2–24: a
fixed 23-hour contract. Loss is mean log-scale pinball across all 115 (hour, level) items;
it is a proper scoring rule, so honesty about uncertainty is rewarded.

## Why ratio-to-hour-1 comparables

Every comparable launch supplies a full hourly curve aligned to its own UTC `day_start`.
Because only the target's hour 1 is known, we normalize each comparable by its own hour-1
viewers: `r_c(h) = viewers_c(h) / viewers_c(1)`. The predicted median is then
`p1 * r_hat(h)`, where `r_hat` is a robust weighted combination of the `r_c` curves. This
transfers the *shape* of real launch days while anchoring the *level* to the one number
actually observed.

## Features extracted per comparable (`src/curves.ts`)

- 24-point release-day ratio curve; hour-1 anchor = 1; unsampled hours stay `null` and
  are never imputed (they are simply absent from that hour's statistics).
- `tier` from the research `Tier:` label with negation-safe fallbacks (a note saying "No
  early access" is clean, not contaminated): `comparable`, `early-access`, `weak`,
  `target-history`, `unknown`.
- `regime` from unlock text: `rolling` (midnight local / rolling), `simultaneous` (single
  global unlock), or `unknown`. GTA6 and all four practice launches are rolling.
- `platform` family (`console`, `cross`, `pc`, `unknown`) used only by the optional
  platform-affinity ablation.
- `v1` (hour-1 viewers) and peak hour/ratio, used for weighting and diagnostics.
- `logHeat = log(hour1 / prelaunch level)` is computed only from checkpoint-available
  data (the comparable's own hour-1 print and pre-release hours). It is a **diagnostic
  field only** in the shipped model (`heatMix = 0`) and never affects the weights. It is
  always present as a finite number or `null`; pathological ratios are clamped to ±4.

## Ensemble weights (`src/model.ts`)

For target hour-1 `p1` and regime `R` from the case notes:

```
w_c = tier(c) * regime(c,R) * exp(-0.5 * ((ln v1_c - ln p1)/1.2)^2) * heat? * platform?
```

- tier: comparable `1.0`, weak `0.25`, early-access `0.12`, target-history `0` (no
  release-day anchor), unknown `0.4`.
- regime: match `1.0`, mismatch `0.4`, unknown `0.6` — deliberately soft, not a hard
  filter.
- scale: Gaussian in log viewers, bandwidth `1.2`. Critical: without it, tiny pre-surge
  comparables (Silksong 164 viewers at hour 1, ~2120× peak) swamp the consensus (LOCO
  `0.756` vs `0.395`).
- weights below `1e-4` are dropped; all arithmetic runs in fixed numeric order.
- `heat?` and `platform?` are OPTIONAL ablation factors, both exactly `1` in production.
  A missing or non-finite heat value degrades to a **neutral** factor of `1` — never to
  `NaN` or zero. Explicit `Number.isFinite` guards ensure an optional diagnostic can
  never silently zero every comparable and collapse the forecast onto the house baseline.
  Regression tests assert this under `NaN`/`±Infinity` and when all prelaunch data is
  stripped.

For each hour, the centre is
`0.6 * weighted_median(ln r_c(h)) + 0.4 * weighted_mean(ln r_c(h))` — robust to outliers
but smoother than a pure median. Comparables that did not sample hour `h` are simply
absent from that hour's statistics. If no comparable survives (or total weight is zero),
the forecast falls back **exactly** to the house persistence baseline — same coarse `Z`
values and same 2-decimal rounding.

## Quantile band

The log-space half-width is
`sigma_h = clamp(1.0 * sqrt(weighted_var(ln r_c(h))), 0.10, 1.50)`, and
`q_tau(h) = p1 * exp(centre_h + z_tau * sigma_h)` with precise normal quantiles
`(-1.6449, -0.6745, 0, 0.6745, 1.6449)`. The house baseline uses the coarser five-element
`Z = (-1.645, -0.674, 0, 0.674, 1.645)`; a regression test pins `Z.length === 5` because
a six-element vector once made the scorer skip every row and report a false zero score.
Output quantiles are clamped to `(0, 1e9]` and forced monotone. The multiplier `1.0` and
floors were chosen on the LOCO backtest, not by intuition; an `empirical` weighted-quantile
mode exists as an ablation but is not used in production (worse calibration).

## Calibration evidence (exact, reproducible)

`docs/evidence/backtest-report.md` gives full protocols and ablations. Scoring is the
exact competition log pinball loss over 37 usable comparables; "rolling" is the 11 clean
rolling-midnight console launches matching the target regime.

| Protocol | House baseline (all / rolling) | RAMQE-1.0.0 (all / rolling) |
|---|---|---|
| LOCO (all other comparables; published benchmark) | 0.929650 / 0.363046 | 0.395114 / 0.251989 |
| Strictly prequential temporal holdout (explicit date gate) | 1.049189 / 0.413219 | 0.537588 / 0.304398 |

LOCO coverage is `0.908` (all) / `0.901` (rolling); temporal coverage `0.767`. These are
local research numbers, **not** official practice or final grades, and no top-rank or
reward claim follows from them. Tuning is in-sample on the comparables; see the report for
the honest limitations.

## Rejected v2 ideas (kept only as disabled ablation switches)

All were measured under the same leakage-safe protocol and **not shipped**:

- Release-date gating in production: LOCO `0.502487` vs `0.395114` — harmful. The date
  gate is applied ONLY inside the temporal backtest, per pseudo-case; `maxDayStartMs =
  Infinity` in the shipped config.
- Hour-1 audience-heat similarity: `0.399612` (mix 0.25) / `0.405980` (mix 0.75) vs
  `0.395114` — no LOCO gain; small temporal differences are not a demonstrated gain on
  the published benchmark.
- Platform affinity: `0.399001` vs `0.395114` — no gain.
- Log-ratio clipping (1.5): `0.705747` vs `0.395114` — clearly harmful.
- All combined as the rejected v2 build: LOCO `0.761956`, temporal `0.846343`.

Each is an opt-in config switch, OFF by default; audience heat remains a diagnostic field
only.

## Data leakage policy

- The four practice launches' withheld targets are never used as training labels,
  features, or tuning signals, and they are not in any practice case's comparables list.
- LOCO hides the held launch's own hours 2–24 and forecasts from **all other** comparables,
  matching the published benchmark. No release-date gate is applied in LOCO.
- The temporal protocol sorts comparables by release date and, for each pseudo-case, uses
  only material that existed strictly before that launch; the gate is explicit per
  pseudo-case.
- Both protocols score only hours 2–24 of the held launch against its recorded actuals.

## Deliberate non-signals

- The GTA6 prelaunch category is a `target-history` comparable: informative context, but
  it has no release-day hour-1 anchor, so it is excluded from ratio curves (weight 0).
- A tested prelaunch-level ratio (`v1/prelaunch`) had only ~0.17 correlation with peak
  ratio, so it was **not** added — no invented signal.
- No minute-level smoothing, no interpolation of unsampled hours, no fake confidence.

## Determinism and robustness

- Sorted input files, stable sort tie-breaks using `localeCompare` on a name key, fixed
  numeric order, no RNG, no clock in the core: identical input + config → identical bytes.
- Untrusted JSON is parsed with per-field numeric coercion (`num`/`count`/`str`); missing,
  `NaN`, and `Infinity` become `null` and degrade via explicit fallbacks. Cases missing
  the five levels, the hour-1 print, forecast rows, or a valid `day_start` are rejected by
  `parseCase` and logged to stderr by `main.ts` with **no output file** written.
- Runtime `ComparableCurve` objects always carry a finite-or-null `logHeat` property;
  regression tests assert the field exists and that missing/non-finite heat cannot zero
  the analogue weights or trigger a silent fallback.
- Output is validated against the exact contract (one `hours` key, 23 rows for hours
  2–24, two keys per row, five finite positive non-decreasing quantiles, ≤65,536 bytes)
  before writing.

## CLI usage

```bash
node main.ts                                   # grader defaults: /input -> /output
MAKEFUN_INPUT_DIR=... MAKEFUN_OUTPUT_DIR=... node main.ts
npm test
node tools/backtest.ts /path/to/p00.in /tmp/backtest-report.json
npm run backtest:help
```

All diagnostics are stderr-only; stdout and the emitted `.out` files stay machine-readable.
