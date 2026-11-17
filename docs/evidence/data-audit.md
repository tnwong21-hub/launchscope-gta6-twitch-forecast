# Data Audit — GTA6 Twitch CCU Forecast (LaunchScope / RAMQE)

Date: 2026-11-17. Source: official dev kit `input/p00.in`..`p03.in` + `NOTICE.txt` + `RULES.txt`.
All figures below are read directly from the supplied practice inputs. No practice target answers
are used or available locally (per `AGENTS.md` Gate 7, the kit has no local scorer/reference answers).

## Case schema (confirmed)
- Top-level keys: `schema, id, game{name,twitch_id}, day_start, checkpoint, levels, known, forecast,
  history, history_hourly, streams, categories_hourly, comparables, notes`.
- `known`: exactly one row, hour 1, with `viewers`, `channels`, `reads` (reads=1 in practice).
- `forecast`: 23 rows, hours 2..24, only `{hour, from, until}` — **no viewers** (targets withheld).
- `history` / `history_hourly`: pre-checkpoint points, oldest first. Practice spacing is SullyGnome's
  hourly samples; small categories are sparse (~every 12 h in quiet periods). `channels` may be null.
- `streams`, `categories_hourly`: **null in all four practice cases** (final-only fields).
- `comparables`: 38 launches in every practice case (all identical across cases), each
  `{name, day_start, unlock, platforms, source, hourly:[{from,viewers,channels,reads}]}`.
  Hourly curve spans day_start-14d .. day_start+3d; big launches have all 24 release-day hours present.
  One comparable in every case is the GTA6 category's own prelaunch history (2026-08-27..2026-11-17,
  tier `target-history`, sparse, peak ~1.42M at the extended-look premiere).

## Practice launches (hour-1 prints, all rolling-midnight console)
| id | game | p1 viewers | p1 channels | real unlock (from notes) |
|----|------|-----------:|------------:|--------------------------|
| p00 | Marvel's Wolverine | 23,357 | 619 | rolling midnight local; US East 04:00Z; PS5 only |
| p01 | Red Dead Redemption 2 | 116,550 | 2,435 | rolling; US unified Eastern midnight 04:00Z; console only |
| p02 | God of War Ragnarök | 269,517 | 2,709 | rolling midnight local every tz; no simultaneous |
| p03 | Marvel's Spider-Man 2 | 119,087 | 1,784 | rolling midnight (NZ/India first); PS5 only |

The four practice launches are explicitly excluded from every case's comparables. The final case
(h00) will include all 42 (the 38 + these four), which are the most relevant rolling-midnight
console analogues; the model must therefore rank comparables by regime/quality/scale generically.

## Comparable structure (from `unlock` text `Tier:` labels)
- Tier `comparable`: clean single-launch analogues (18 of 38 incl. rolling console: Resident Evil
  Requiem, Monster Hunter Wilds, CoD BO6/MW3/BO7/MW4, FF7 Rebirth, TLOU2, Ghost of Tsushima,
  Zelda TOTK, Stellar Blade, Ghost of Yotei, ...; some simultaneous-global: Black Myth Wukong,
  Battlefield 6, Silksong, ...).
- Tier `early-access-contaminated`: peak occurs on pre-release early-access days (Hogwarts, Diablo IV,
  Starfield, 007 First Light, Death Stranding 2, Assassin's Creed Shadows, DOOM Dark Ages, Forza H6/5) —
  their UTC "release day" is post-peak, a poor analogue for a no-early-access launch.
- Tier `weak`: live-service / F2P / slow-burn (Marvel Rivals, HELLDIVERS 2, ARC Raiders, Marathon,
  Elden Ring Nightreign).
- Tier `target-history`: GTA6 prelaunch category (not a launch; no release-day hour-1).

## Release-day ratio-to-hour-1 shapes (clean rolling-midnight comparables, hours 1..24)
Key empirical facts:
- Hours 2–5 are flat/declining (US asleep), then a rise begins at the US-unlock hours (~05–08Z),
  peaking in US afternoon/evening (hours ~16–22 UTC), then partial decay by hour 24.
- Peak/hour-1 ratio for clean rolling console launches spans roughly 1.3–3.6x (TLOU2 1.34,
  FF7 Rebirth 2.24, M. Hunter Wilds 2.64, CoD BO6 2.74, Ghost of Yotei 3.62); Resident Evil Requiem
  is a high outlier at 12.1x because its 00Z hour-1 is EU-only before the US unlock.
- Simultaneous-global comparables and early-access comparables have hour-1 either pre-surge (huge
  ratios) or post-peak (declining curves); they must be down-weighted by regime/tier for a rolling target.

## Consequence for modelling
- The forecast target is a **rolling-midnight, no-early-access, console AAA** — same regime as all four
  practice launches and several clean comparables.
- Primary signal: p1 × an ensemble of regime-matched, tier-clean comparable ratio curves; weighted by
  regime match, tier quality and scale similarity; robust to outliers.
- Uncertainty: empirical residual quantiles from leave-one-comparable-out backtests (out of fold),
  pooled by horizon with conservative fallback; never decorative zero-width bands.
- Backtest: LOCO over the 38 comparables (pseudo-cases cut at their own hour 1), scored with the exact
  log pinball loss. Practice p00..p03 cannot be scored locally (targets withheld) — stated plainly.
