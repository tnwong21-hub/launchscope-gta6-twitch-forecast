# RAMQE — Model Method Note (LaunchScope)

Version `RAMQE-1.0.0`. Standard library only, deterministic, no network. This note is the
auditable description of the code in `src/`.

## Target and framing
The scored quantity is Twitch's **concurrent viewers in the GTA VI category** (game id 1867279146),
not game players, sales or console CCU. We observe only hour 1's print `p1` at the checkpoint. We
must produce five quantiles for each of hours 2–24. Loss is mean log-scale pinball across all
(hour, level) items; a proper scoring rule, so honesty about uncertainty is rewarded.

## Why ratio-to-hour-1 comparables
Each comparable launch supplies its full hourly curve aligned to its own UTC `day_start`. Because
we only know the target's hour 1, we normalise every comparable curve by its own hour-1 viewers:
`r_c(h) = viewers_c(h) / viewers_c(1)`. The predicted median is then `p1 * r_hat(h)`, where `r_hat`
is a robust weighted combination of the `r_c` curves. This transfers the *shape* of real launch
days while anchoring the *level* to the one number we actually observe.

## Features extracted per comparable (`src/curves.ts`)
- 24-point release-day ratio curve; hour 1 anchor = 1; missing hours stay null (never imputed).
- `tier` from the research `Tier:` label with negation-safe fallbacks (a note saying "No early
  access" is clean, not contaminated): `comparable`, `early-access`, `weak`, `target-history`.
- `regime` from unlock text: `rolling` (midnight local / rolling), `simultaneous` (single global
  unlock), or `unknown`. GTA6 and all four practice launches are rolling.
- `v1` (hour-1 viewers) and peak hour/ratio, used only for weighting/diagnostics.

## Ensemble weights (`src/model.ts`)
For target hour-1 `p1` and regime `R` from the case notes:

```
w_c = tier(c) * regime(c,R) * exp(-0.5 * ((ln v1_c - ln p1)/1.2)^2)
```
- tier: comparable 1.0, weak 0.25, early-access 0.12, target-history 0 (no release-day anchor).
- regime: match 1.0, mismatch 0.4, unknown 0.6 — deliberately soft, not a hard filter.
- scale: gaussian in log viewers, bandwidth 1.2. Critical: without it, tiny pre-surge comparables
  (Silksong 164 viewers at hour 1, ~2120× peak) swamp the consensus (ablation loss 0.756 vs 0.395).
- weights below 1e-4 are dropped; all arithmetic is in fixed numeric order.

For each hour, the centre is
`0.6 * weighted_median(ln r_c(h)) + 0.4 * weighted_mean(ln r_c(h))` — robust to outliers but
smoother than a pure median. Comparables that did not sample hour `h` are simply absent from that
hour's statistics. If no comparable survives, the forecast falls back **exactly** to the house
persistence baseline (same z values, same 2-decimal rounding).

## Quantile band
The log-space band half-width is
`sigma_h = clamp(1.0 * sqrt(weighted_var(ln r_c(h))), 0.10, 1.50)`, and
`q_tau(h) = p1 * exp(centre_h + z_tau * sigma_h)` with precise normal quantiles
`(-1.6449, -0.6745, 0, 0.6745, 1.6449)`. Output quantiles are clamped to `(0, 1e9]` and forced
monotone. The multiplier 1.0 and floors are set by the LOCO backtest, not by intuition; an
`empirical` weighted-quantile mode exists as an ablation but is not used in production (worse
calibration, 0.854 coverage vs 0.901).

## Calibration evidence
`../artifacts/backtest-report.md` gives the full leave-one-comparable-out results and ablations.
On the 11 clean rolling-midnight comparables (the target regime): loss 0.252 vs baseline 0.363,
typical miss 43.2% vs 73.6%, coverage 0.901. On all 37 usable comparables: 0.395 vs 0.930. These
are local research numbers, **not** official practice or final grades.

## Deliberate non-signals
- The four practice launches' targets are withheld and never used.
- The GTA6 prelaunch category is a `target-history` comparable: informative context, but it has no
  release-day hour-1 anchor, so it is excluded from ratio curves (weight 0).
- A tested prelaunch-level ratio (`v1/prelaunch`) had only 0.17 correlation with peak ratio, so it
  was **not** added — no invented signal.
- No minute-level smoothing, no interpolation of unsampled hours, no fake confidence.

## Determinism / robustness
- Sorted input files, stable sort tie-breaks using `localeCompare` on a fixed locale-independent
  name key, fixed numeric order, no RNG, no clock in the core.
- Untrusted JSON is parsed with per-field numeric coercion; missing/NaN/Infinity become null and
  degrade via fallbacks. Malformed cases are logged to stderr and produce no output file.
- Output is validated against the exact contract (one `hours` key, 23 rows 2–24, five finite
  positive non-decreasing quantiles, ≤65,536 bytes) before writing.
