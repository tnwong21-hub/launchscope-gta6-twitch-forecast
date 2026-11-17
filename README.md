# LaunchScope / RAMQE — GTA6 Twitch CCU Forecast

Offline competition entry for the Make.fun bounty **"Forecast GTA VI's launch-day Twitch viewers
hour by hour"**. The scored deliverable is this deterministic forecaster (`main.ts`), not the LIVE
app. Node 22, standard library only, no network, no installed packages.

## Run

```bash
NODE=/opt/node-v22.23.4-linux-x64/bin/node

# On the four practice inputs (writes p00.out .. p03.out):
mkdir -p /tmp/opencode/out
MAKEFUN_INPUT_DIR=../kit/unpacked/gta6-twitch-ccu-forecast-01-kit/input \
MAKEFUN_OUTPUT_DIR=/tmp/opencode/out "$NODE" main.ts

# Grader defaults (env unset): reads /input/*.in, writes /output/<id>.out.
"$NODE" main.ts
```

`main.ts` reads every `*.in` in filename order and writes exactly one `<id>.out` per case.

## Test

```bash
"$NODE" --test test/*.test.mjs      # 18 tests: schema, contract, model, edge, determinism, timing
"$NODE" tools/backtest.ts           # LOCO backtest + ablations -> ../artifacts/backtest-report.json
```

All 18 tests pass locally; four cases forecast in well under one second total (8 s/case cap).

## Input / output contract
- Input: official `makefun/twitch-ccu-case/v1` JSON. See `artifacts/data-audit.md` for the audited
  schema and every field actually present in p00–p03.
- Output: UTF-8 JSON, exactly `{"hours":[{"hour":h,"q":[q05,q25,q50,q75,q95]}, ...]}` for hours
  2–24 only; five finite viewers `>0` and `≤1e9`, non-decreasing; one regular file ≤65,536 bytes.
- Invalid/malformed cases are logged to **stderr only** and produce no output file (never an
  invalid one). Core output is validated before write.

## Method (summary)
RAMQE anchors the level to the observed hour-1 print and transfers the *shape* from weighted
historical launch analogues expressed as ratios to their own hour 1. Weights combine research
tier, unlock-regime match (rolling midnight local for GTA6) and log-scale similarity of hour-1
counts. The centre is a robust log-space median/mean blend; the band is sized from empirical
cross-sectional dispersion calibrated out-of-fold. No comparable → exact house-baseline fallback.
Full detail: `MODEL-METHOD.md`; evidence: `../artifacts/backtest-report.md`.

## No-network guarantee
The entrypoint and every module under `src/` import only `node:fs`, `node:path` and standard
language features. There is no `fetch`, `http(s).request`, socket, child-process, telemetry, secret
read or clock/RNG in the core. A test asserts these APIs are absent from shipped source.

## Repository layout
- `main.ts` — entrypoint (I/O + validation + serialization)
- `src/` — types, case parsing, comparable curves, model, scoring, contract
- `tools/backtest.ts` — independent leakage-safe backtest (not shipped to grader runtime)
- `test/` — no-dependency Node test suite
- `artifacts/` (workspace parent) — data audit and backtest evidence
- `../live/` — separate standalone LIVE source deliverable (not the scored entry)

## Limitations
- The kit has no local scorer/reference answers; practice p00–p03 targets are withheld. Backtests
  are on the comparables only and tuning is in-sample on those; no official grade is claimed.
- The final uses minute-mean prints versus SullyGnome hourly averages in practice — related but
  not identical measures.
- Band calibration rests on 11 clean rolling comparables; treat regime-specific figures as
  indicative, not guaranteed.
- No submission, signing, deployment or prize claim is performed by this repository.
