# Token Radar

[![token-radar-01 on make.fun](https://make.fun/c/token-radar-01/badge.svg)](https://make.fun/c/token-radar-01)

Built for the [token-radar-01 bounty on make.fun](https://make.fun/c/token-radar-01):
build the best token launch radar. The program reads a sealed snapshot of
every protocol DefiLlama tracks, finds the ones that record no token, and
ranks them by what their launch would be worth — then shows the board, a
detail view per protocol, and the steps to farm each one.

## What it ranks

198 protocols that record no token (both `gecko_id` and `symbol` null, not
a versioned, wrapped, staked or bridged product of a token that already
trades, category not Bridge / Canonical Bridge / Liquid Staking / Liquid
Restaking / Restaked BTC / CEX). The 40 protocols on the snapshot's
watchlist are all covered, plus every other qualifier below the floor.

A protocol "records no token" in DefiLlama's data. That is not proof it
has none, and the board never claims otherwise.

## The model

Implied value = `TVL x multiple x momentum x maturity x chains`, capped
at $100,000,000,000,000 and floored at $1. The score is the log-scaled
implied value, 0 to 100.

- **Multiple.** The median mcap/TVL ratio of token-bearing protocols in
  the same category (at least 3 samples, otherwise the global median).
  14 categories calibrate from their own median; the rest fall back to
  the global median of 0.2138 (128 samples). No shrinkage: a category
  with exactly 3 samples uses its median directly.
- **Momentum.** `1 + 0.004 x 7-day TVL change`, change clamped to
  +/-50%, so the factor stays in 0.8..1.2. Null change is neutral (1).
- **Maturity.** `0.9 + 0.2 x age / 3 years`, age capped at 3 years, so
  the factor stays in 0.9..1.1. Older, large, still-tokenless protocols
  score higher. Null listing date is neutral (1), never penalised.
- **Chains.** `1 + 0.02 per extra chain`, capped at 5 extra chains
  (factor at most 1.10).

Total implied value across the board is $4.90B. The top protocol,
Steakhouse Financial (Risk Curators), implies $641,480,719.

## Why the median, not the mean

Among the 128 token-bearing protocols with market-cap data, the mean
mcap/TVL ratio is 5.0386 but the median is only 0.2138, and the largest
ratio is 400.2045. A handful of giants pull the mean far above the
typical protocol, so a mean multiple would overstate most launches. The
same gap shows inside CEX: mean 7.8246 against a median of 0.0748.

## Sensitivity

Re-ranking with one choice changed: the mean-multiple variant moves the
ranking most (Spearman 0.7875, top-10 overlap 7 of 10, median move 26
ranks, 194 of 198 rows move). Removing momentum (0.9989), maturity
(0.9981) or chains (0.9995) barely moves it. Sensitivity measures
stability of the ranking under changed assumptions, not predictive
accuracy. Nothing here predicts whether or when a token launches, and
there is no out-of-sample predictive validation.

## Farm plans

Every row carries a 3-step farm plan tailored to its category group
(DEX, lending, derivatives, vault, CDP, RWA, staking, chain, bridge,
BTC, prediction, insurance, payments, governance, indexes, OTC, or the
generic plan). Every step states the capital, what the action costs,
how long the action takes, how long to hold, and the exit condition or
risk for that kind of protocol. A hold or exit step that needs no new
transaction says so explicitly.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path>/snapshot.json
```

Node 22.18 or later, standard library only. Two runs write
byte-identical outputs. The program writes `board.json`, the dashboard
data (`dashboard/rows.js`), copies `dashboard/` and `screenshots/`, and
writes `dossier.json` with `buildDossier` from `vendor/makefun-board.ts`.

## Layout

- `main.ts` — the program (entrypoint)
- `dashboard/` — the static page (index.html, app.css, app.js; no network)
- `screenshots/` — board, detail, filtered, methodology (1440x900)
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte from the kit
- `board.json` is written by the program into the output directory, not kept in the repo
