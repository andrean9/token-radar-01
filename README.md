# Token Radar — token-radar-01

[![make.fun](https://make.fun/badge.svg)](https://make.fun/c/token-radar-01)

A radar for the token launches that have not happened yet: every tokenless
protocol in the frozen DefiLlama snapshot, ranked by implied token value,
with a farm plan for each one.

## What it is

The snapshot holds 758 protocols at or above $5M TVL. 198 of them record
no token at all — no CoinGecko id, no ticker — and pass the tokenless
filter (no versioned name, no bridge / staking / CEX bucket, no wrapped or
staked product, no exchange prefix). 40 of the 198 are on the house
watchlist (TVL ≥ $50M); the other 158 qualify the same way below the
floor. This entry ranks all 198.

## The model

**Implied value = TVL × category multiple × momentum × maturity × chains.**

**Calibration — the median, not the mean.** For each category, the
multiple is the median mcap/TVL ratio of the token-bearing protocols in
the same category that carry a positive market cap (at least 3 samples;
otherwise the global median). The median is the whole point of the model,
because the ratio distribution is grotesquely skewed on this snapshot:

| Set | Mean | Median |
| --- | --- | --- |
| All token-bearing protocols (n=128) | 5.0386 | 0.2138 |
| CEX (n=9) | 7.8246 | 0.0748 |

The maximum ratio in the snapshot is 400.20. A mean multiple would price
every tokenless protocol as if it were the average of a distribution
dominated by two or three outliers. The sensitivity run in the dashboard
proves it: swapping the median for the mean is the only variant that
scrambles the ranking (Spearman ρ 0.79, median rank move 26 places,
194 of 198 rows move); turning momentum, maturity or chains off barely
moves anything (ρ > 0.998, top 10 intact).

**The factors.**

- Momentum = 1 + 0.004 × the 7-day TVL change, capped at ±50%. Null change
  means zero momentum (factor 1), never a penalty.
- Maturity = clamp(1 + (age in years − 1.5) / 15, 0.9, 1.1), age measured
  from `listed_at` to the snapshot date. An old, large, still-tokenless
  protocol scores higher. Null `listed_at` is neutral (factor 1).
- Chains = 1 + 0.02 per extra chain, capped at +10% (6+ chains).

**Ranking and score.** Rows sort by implied value, descending; the score
is the min-max normalisation of log₁₀(implied value) across the board,
0–100 with one decimal, so rank order and implied-value order agree.

**Farm plan.** Three steps per protocol, tailored to its category and
naming its own chains: an opening action, a 30-day holding rule so the
activity counts as sticky usage, and a follow-up.

## Results (snapshot 2026-11-14)

- 198 ranked rows, 40/40 watchlist covered, 0 filter violations.
- Risk Curators dominate: 34 protocols, 42.8% of total implied value,
  led by Steakhouse Financial at #1.
- 33 categories carry at least one qualifier; 14 categories calibrate
  from their own median, the rest fall back to the global median 0.2138.

## The program

`main.ts` (Node 22+, standard library only) reads the snapshot
(`--input`, or `/input/snapshot.json` at grading), writes `board.json`,
the dashboard data (`dashboard/rows.js`), copies `dashboard/` and
`screenshots/` into the output directory, and writes `dossier.json`
with `buildDossier` from `vendor/makefun-board.ts` (the kit's scorer
library, vendored unchanged).

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Two runs on the same input write byte-identical outputs. The program
clears only the *contents* of the output directory, never the directory
itself.

## Dashboard

Static, no network requests: the board (sortable, searchable, filterable
by category and chain), a per-category summary panel (click a row to
filter the board), a detail view per protocol with its farm plan and
model reasoning, and the methodology section with the calibration table
and the sensitivity table.

## License

MIT — see `LICENSE`.
