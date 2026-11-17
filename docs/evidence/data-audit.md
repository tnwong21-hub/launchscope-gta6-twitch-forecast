# Data Audit — GTA6 Twitch CCU Forecast (LaunchScope / RAMQE-1.0.0)

Source: official dev kit `input/p00.in`..`p03.in` + `NOTICE.txt` + `RULES.txt`. All figures below are
read directly from the supplied practice inputs. This is **local research** for the Make.fun GTA VI
Twitch CCU forecast bounty: **no official grade, practice score, leaderboard rank, prize, or top-rank
claim is made**.

## Case schema (confirmed)

- Top-level keys: `schema, id, game{name,twitch_id}, day_start, checkpoint, levels, known, forecast,
  history, history_hourly, streams, categories_hourly, comparables, notes`.
- `known`: exactly one row — hour 1, with `viewers`, `channels`, `reads` (reads = 1 in practice).
  This hour-1 print `p1` is the only observed target quantity; the forecast is anchored to it.
- `forecast`: 23 rows, hours 2..24, only `{hour, from, until}` — **no viewers**. The four practice
  targets are **withheld**: their viewers never appear locally and are never used as labels,
  features, tuning signals, or hard-coded outputs.
- `history` / `history_hourly`: pre-checkpoint points, oldest first. Practice spacing is SullyGnome's
  hourly samples; small categories are sparse (~every 12 h in quiet periods); `channels` may be null.
  These are the only source of the optional target `logHeat` diagnostic, which is **diagnostic only**
  in the shipped model (`heatMix = 0`).
- `streams`, `categories_hourly`: null in all four practice cases (final-only fields). The scoring
  core tolerates them but does not require them.
- `comparables`: 38 launches in every practice case, identical across cases, each
  `{name, day_start, unlock, platforms, source, hourly:[{from,viewers,channels,reads}]}`; curves span
  roughly day_start-14d .. day_start+3d. One row is the GTA6 category's own prelaunch history
  (tier `target-history`, no release-day hour-1) and is excluded from ratio curves (weight 0),
  leaving **37 usable comparables**. The 11 clean rolling-midnight console launches are the
  target-relevant subset.

## Practice launches (hour-1 prints, all rolling-midnight console)

| id | game | p1 viewers | p1 channels | real unlock (from notes) |
|----|------|-----------:|------------:|--------------------------|
| p00 | Marvel's Wolverine | 23,357 | 619 | rolling midnight local; US East 04:00Z; PS5 only |
| p01 | Red Dead Redemption 2 | 116,550 | 2,435 | rolling; US unified Eastern midnight 04:00Z; console only |
| p02 | God of War Ragnarök | 269,517 | 2,709 | rolling midnight local every tz; no simultaneous |
| p03 | Marvel's Spider-Man 2 | 119,087 | 1,784 | rolling midnight (NZ/India first); PS5 only |

These four practice launches are explicitly excluded from every case's comparables. The final case
(h00) will include all 42 (the 38 + these four), the most relevant rolling-midnight console
analogues; the model ranks them generically by tier / unlock regime / log-scale hour-1 similarity,
with no hard-coded practice-case list.

## Comparable structure (from `unlock` text `Tier:` labels)

- `comparable`: clean single-launch analogues (rolling console: Resident Evil Requiem, Monster
  Hunter Wilds, CoD BO6/MW3/BO7/MW4, FF7 Rebirth, TLOU2, Ghost of Tsushima, Zelda TOTK, Stellar
  Blade, Ghost of Yotei; some simultaneous-global: Black Myth Wukong, Battlefield 6, Silksong).
- `early-access`: peak on pre-release early-access days (Hogwarts, Diablo IV, Starfield, 007 First
  Light, Death Stranding 2, Assassin's Creed Shadows, DOOM Dark Ages, Forza H6/5) — a poor analogue
  for a no-early-access launch; down-weighted.
- `weak`: live-service / F2P / slow-burn (Marvel Rivals, HELLDIVERS 2, ARC Raiders, Marathon,
  Elden Ring Nightreign); down-weighted.
- `target-history`: GTA6 prelaunch category (not a launch; no release-day hour-1; weight 0).

Classification is negation-safe ("No early access" is clean), and tiers/regimes are soft weights,
not hard filters.

## Empirical shape observations

- Hours 2–5 are flat/declining (US asleep), a rise begins around US-unlock hours (~05–08Z), peaking
  in US afternoon/evening (hours ~16–22 UTC), then partial decay by hour 24.
- Peak/hour-1 ratio for clean rolling console launches spans roughly 1.3–3.6x; Resident Evil Requiem
  is a ~12x outlier because its 00Z hour-1 is EU-only before the US unlock.
- Simultaneous-global and early-access comparables have hour-1 either pre-surge or post-peak; scale
  similarity is critical (removing it regresses LOCO from 0.395114 to 0.756314).
- The measured correlation between prelaunch `logHeat` and peak ratio is weak (~0.17), so no
  prelaunch-level signal was promoted into the shipped model.

## Shipped model and diagnostics (RAMQE-1.0.0)

- Primary signal: `p1 ×` a robust (0.6 weighted-median / 0.4 weighted-mean in log space) ensemble of
  regime-matched, tier-clean comparable ratio curves, weighted by tier, regime and log-scale hour-1
  similarity.
- Uncertainty: a weighted-dispersion log-space band with five quantiles (0.05/0.25/0.5/0.75/0.95);
  never zero-width/decorative. `Z` has exactly five levels; band multiplier 1.0.
- Every runtime `ComparableCurve` exposes a finite-or-null `logHeat` property. Missing or non-finite
  diagnostics degrade to a neutral weight factor — never NaN, zero total weight, or a silent
  collapse onto the house baseline.

## Validation metrics (exact, local research)

| Protocol | House baseline | RAMQE-1.0.0 production | Production rolling |
|---|---|---|---|
| LOCO (all other comparables) | 0.929650 | **0.395114** | 0.251989 |
| Strictly prequential temporal holdout | 1.049189 | **0.537588** | 0.304398 |

The new heat-mix, platform-affinity, and release-date-gate variants were measured and **were not
selected** (all off by default); log-ratio clipping was clearly harmful. Two leakage-safe protocols
were used: LOCO over 37 comparables with no date gate, and a strictly prequential temporal holdout
with an explicit per-pseudo-case date gate that is never enabled in production. Practice p00–p03
cannot be scored locally (targets withheld) — stated plainly. These numbers are **not** an official
practice score, final grade, leaderboard rank, or top-rank claim. Full tables are in
`backtest-report.md`.
