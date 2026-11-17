# Contributing

Thanks for taking an interest in LaunchScope / RAMQE.

## Development requirements

- Node.js 22 or newer.
- No third-party runtime dependencies are required.
- Keep the scoring entrypoint deterministic and offline-first.

## Before opening a pull request

```bash
npm test
npm run backtest
```

Please include tests for behavior changes and update `MODEL-METHOD.md` when a change affects model assumptions, weighting, calibration, or output semantics. Report benchmark protocol and limitations; do not describe local backtest metrics as an official Make.fun score.

## Design constraints

- Preserve the exact `makefun/twitch-ccu-case/v1` input and output contract.
- Never use withheld practice targets or fabricate validation results.
- Keep network access, telemetry, randomness, and wall-clock dependencies out of the scoring core.
- Keep diagnostics on stderr; stdout and output files must remain machine-readable.
