# RAMQE-1.0.0 — Model Method Note (LaunchScope)

Version `RAMQE-1.0.0` (the published v1 algorithm). Standard library only, deterministic, no
network. This note is the auditable description of the code in `src/`. It is **local research**,
not an official Make.fun result; no official practice score, grade, rank or prize is claimed.

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
- `logHeat = log(hour1 / prelaunch level)`, computed only from checkpoint-available data. It is a
  **diagnostic field only** in the shipped model (`heatMix = 0`); it never affects the weights.

## Ensemble weights (`src/model.ts`)
For target hour-1 `p1` and regime `R` from the case notes:

```
w_c = tier(c) * regime(c,R) * exp(-0.5 * ((ln v1_c - ln p1)/1.2)^2) * heat? * platform?
```
- tier: comparable 1.0, weak 0.25, early-access 0.12, target-history 0 (no release-day anchor).
- regime: match 1.0, mismatch 0.4, unknown 0.6 — deliberately soft, not a hard filter.
- scale: gaussian in log viewers, bandwidth 1.2. Critical: without it, tiny pre-surge comparables
  (Silksong 164 viewers at hour 1, ~2120× peak) swamp the consensus (LOCO 0.756 vs 0.395).
- weights below 1e-4 are dropped; all arithmetic is in fixed numeric order.
- `heat?` and `platform?` are OPTIONAL ablation factors, both identity (1) in production. A
  missing or non-finite heat value degrades to a NEUTRAL factor of 1 — never to NaN or zero. A
  final `Number.isFinite` guard ensures an optional diagnostic can never silently zero every
  comparable and collapse the forecast onto the house baseline.

For each hour, the centre is
`0.6 * weighted_median(ln r_c(h)) + 0.4 * weighted_mean(ln r_c(h))` — robust to outliers but
smoother than a pure median. Comparables that did not sample hour `h` are simply absent from that
hour's statistics. If no comparable survives, the forecast falls back **exactly** to the house
persistence baseline (same z values, same 2-decimal rounding).

## Quantile band
The log-space band half-width is
`sigma_h = clamp(1.0 * sqrt(weighted_var(ln r_c(h))), 0.10, 1.50)`, and
`q_tau(h) = p1 * exp(centre_h + z_tau * sigma_h)` with precise normal quantiles
`(-1.6449, -0.6745, 0, 0.6745, 1.6449)`. The house baseline uses the coarser 5-element
`Z = (-1.645, -0.674, 0, 0.674, 1.645)` — exactly five values, matching the five scored levels;
a regression test asserts this because a six-element vector once made the scorer skip every hour
and report a false zero score. Output quantiles are clamped to `(0, 1e9]` and forced monotone.
The multiplier 1.0 and floors were chosen on the LOCO backtest, not by intuition; an `empirical`
weighted-quantile mode exists as an ablation but is not used in production (worse calibration).

## Calibration evidence (exact, reproducible)
`docs/evidence/backtest-report.md` gives full protocols and ablations. Scoring is the exact
competition log pinball loss over 37 usable comparables; "rolling" is the 11 clean rolling-midnight
console launches matching the target regime.

| Protocol | House baseline (all / rolling) | RAMQE-1.0.0 (all / rolling) |
|---|---|---|
| LOCO (all other comparables; published benchmark) | 0.929650 / 0.363046 | 0.395114 / 0.251989 |
| Strictly prequential temporal holdout (explicit date gate) | 1.049189 / 0.413219 | 0.537588 / 0.304398 |

LOCO coverage is 0.908 (all) / 0.901 (rolling); temporal coverage 0.767. These are local research
numbers, **not** official practice or final grades, and no top-rank or reward claim follows from
them. See the report for the honest limitations.

## Rejected v2 ideas (kept only as disabled ablation switches)
All three were measured under the same leakage-safe protocol and **not shipped**:
- Release-date gating in production: LOCO 0.502487 vs 0.395114 — harmful in production. The date
  gate is applied ONLY inside the temporal backtest, per pseudo-case; `maxDayStartMs = Infinity`
  in the shipped config.
- Hour-1 audience-heat similarity: 0.399612 (mix 0.25) / 0.405980 (mix 0.75) vs 0.395114 — no LOCO
  gain; the small temporal differences are not a demonstrated improvement on the published benchmark.
- Platform affinity: 0.399001 (mix 0.5) vs 0.395114 — no gain.
- Log-ratio clipping (1.5): 0.705747 vs 0.395114 — clearly harmful.
- All combined as the rejected v2 build: LOCO 0.761956, temporal 0.846343.
Each is an opt-in config switch, OFF by default; audience heat remains a diagnostic field only.

## Data leakage policy
- The four practice launches' withheld targets are never used as training labels, features, or
  tuning signals, and they are not present in any practice case's comparables list.
- LOCO hides the held launch's own hours 2–24 and forecasts from **all other** comparables, matching
  the published benchmark. No release-date gate is applied in LOCO.
- The temporal protocol sorts comparables by release date and, for each pseudo-case, uses only
  material that existed strictly before that launch; the gate is explicit per pseudo-case.
- Both protocols score only hours 2–24 of the held launch against its recorded actuals.

## Deliberate non-signals
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
- Runtime `ComparableCurve` objects always carry a finite-or-null `logHeat` property; regression
  tests assert this field exists and that missing/non-finite heat cannot zero the analogue weights.
- Output is validated against the exact contract (one `hours` key, 23 rows 2–24, five finite
  positive non-decreasing quantiles, ≤65,536 bytes) before writing.
