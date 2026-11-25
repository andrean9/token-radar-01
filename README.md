# Token Radar

[![token-radar-01 on make.fun](https://make.fun/c/token-radar-01)](https://make.fun/c/token-radar-01)

A radar for pre-token protocols: which protocol is worth farming next,
and what to do about it. Built for the
[token-radar-01 bounty on make.fun](https://make.fun/c/token-radar-01)
($1,325 escrowed, 10 places).

The entry is a program, not a spreadsheet. `main.ts` (Node 22, standard
library only) reads the sealed DefiLlama snapshot, keeps every protocol
that records no token, and ranks all 198 of them by implied token value.
The dashboard it writes is static and makes no network requests.

## The model

For each category, the multiple is the **median** mcap/TVL ratio of
that category's token-bearing protocols (at least 3 samples, otherwise
the global median). One shared predicate, `isCalibratable`, decides
which protocols calibrate: a protocol must record a token (a CoinGecko
id or a ticker) **and** have a positive market cap on a positive TVL —
the same predicate feeds the calibration table and the diagnostics, so
the population is provably identical in the code.

Implied value = TVL × multiple, adjusted by three small factors:

- **Momentum:** 1 + 0.4 × 7-day TVL change, capped at ±50%. A missing
  change is neutral (factor 1).
- **Maturity:** 0.9 + 0.2 × days since listing / 1095 (3 years, capped).
  Older, still-tokenless protocols score higher. A missing listing date
  is neutral (factor 1), never penalised to zero.
- **Chains:** +0.02 per extra chain, capped at +0.10.

Score is log10 of the implied value, stretched 0–100 across the board.
Rank follows implied value.

## Why the median, not the mean

The ratios are wildly skewed. Across the 128 token-bearing protocols
that calibrate the model, the global mean mcap/TVL is **5.0386** while
the median is **0.2138** and the largest ratio is **400.2045**. A mean
would let a handful of outliers set every category's multiple. CEX
shows the same skew from the other side: mean **7.8246** against a
median of **0.0748**. The median is the typical protocol; the mean is
the loudest one.

## What the numbers mean — and what they do not

**Share of implied value** is a category's share of the board's total
implied value. It is **not** a probability that a token launches.
Risk Curators hold 42.8% of the board's implied value because one
protocol there is very large, not because its token is 42.8% likely.

Limits, stated plainly:

- No shrinkage: a category with only 3 samples uses its median
  directly, and small categories are noisier for it.
- No out-of-sample predictive validation: nothing here proves the
  ranking predicts future launches.
- Sensitivity is stability, not accuracy: the mean multiple is the
  only load-bearing choice (Spearman ρ 0.7875 when the mean replaces
  the median); momentum, maturity and chain count are small nudges
  (ρ > 0.998 each). A ranking can be stable under changed assumptions
  and still be wrong.

## Farm plans

Every board row carries a 3-step farm plan tailored to its category:
sixteen specialist templates (DEX, Lending, Derivatives, Vault, CDP,
RWA, Staking, Chain, Bridge, BTC, Prediction Market, Insurance,
Payments, Governance, Indexes, OTC, plus a Default fallback). Each
step states its own cost and time — a capital amount plus a gas or
fee estimate, how long the action takes, how long to hold — and the
exit condition or risk that belongs to the category (impermanent
loss for DEX, health factor above 1.5 for Lending, stop-loss for
Derivatives, unbonding wait for Staking, peg risk for BTC, and so on).
A protocol is farmed the way its own kind is farmed: BTC is not a
CDP, staking is not a vault, an OTC desk is not an RWA fund.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Two runs write byte-identical outputs. The program writes
`board.json`, the dashboard (`dashboard/` + `rows.js`), the
screenshots, and `dossier.json` (via `buildDossier` from
`vendor/makefun-board.ts`, the kit's own library) into the output
directory. It empties the output directory's contents, never the
directory itself.

## Verification

- 198 rows, rank 1–198, implied value and score decreasing per rank;
  watchlist 40/40; 0 tokenless-filter violations.
- Calibration: 14 categories + global fallback (n = 128).
- Category summary: 33 categories, shares sum to 0.9999.
- Sensitivity: 4 variants, computed from the snapshot inside the program.
- 4 screenshots, 1440×900, each ≤ 512 KiB.
- Dashboard: 0 network references.
- Dossier: under 1.5 MiB, text under 65,536 bytes.
