# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/andrean9/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/andrean9/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Built for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01).

A token launch radar for the make.fun `token-radar-01` bounty. It reads a
sealed snapshot of every protocol DefiLlama tracks, finds the protocols that
record no token yet, ranks them by what their launch would be worth, and hands
in a web dashboard with the board, a detail view for each protocol, and the
steps to farm it.

## Run it

Node 22 or later, nothing to install (standard library only):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

At grading the input is `/input/snapshot.json`. The program writes
`board.json`, `dashboard/` (the page plus its generated `rows.js` data),
`screenshots/`, and `dossier.json` into the output directory. Two runs write
byte-identical outputs: no timestamps, no randomness, stable sort order.

## The board

198 protocols qualify on this snapshot — the 40 watchlist protocols plus
every other protocol that passes the filter below the $50M floor. The
watchlist is a floor, never a ceiling.

### Tokenless filter

A protocol qualifies when all of these hold:

- it records no token: both `gecko_id` and `symbol` are null;
- its name carries no version marker at the end (a space followed by `V2`,
  `v2`, `2.0` or the like);
- its category is not Bridge, Canonical Bridge, Liquid Staking, Liquid
  Restaking, Restaked BTC or CEX;
- its name carries no whole word `wrapped`, `staked` or `staking`, and does
  not begin with an exchange name (Binance, Coinbase, Bybit, Kraken, Bitget,
  OKX, Bitfinex, Gemini).

"Records no token" is DefiLlama's record, not proof: a protocol on the board
may still have a token its record does not carry. A wrapped or staked product
of a token that already trades is not a token that does not exist yet.

### Implied-value model

The multiple is calibrated from the snapshot's own figures, never invented:
for each category, the median mcap/TVL ratio among token-bearing protocols in
the snapshot that carry mcap data, when the category has at least 3 samples;
otherwise the global median across all categories.

| Category | Multiple | Samples |
| --- | --- | --- |
| Basis Trading | 0.6544 | 7 |
| Bridge | 0.5567 | 6 |
| Canonical Bridge | 0.7464 | 8 |
| CDP | 0.1687 | 3 |
| CEX | 0.0748 | 9 |
| Cross Chain Bridge | 1.2205 | 4 |
| Dexs | 0.3424 | 11 |
| Indexes | 0.1477 | 3 |
| Lending | 0.1324 | 15 |
| Liquid Staking | 0.0406 | 9 |
| Privacy | 0.9691 | 3 |
| RWA | 0.2748 | 9 |
| Yield | 0.1914 | 9 |
| Yield Aggregator | 0.1510 | 4 |
| (global fallback) | 0.2138 | 128 |

Then each protocol's implied value is:

```
implied value = TVL x multiple x momentum x maturity x chains
```

- **Value (log scale, dominant):** TVL x multiple. Size decides the rank
  first; the other factors only reorder near neighbours.
- **Momentum (weight 0.4):** `1 + 0.4 x clamp(change_7d, -50, +50) / 100`.
  A +50% week lifts value 20%, a -50% week cuts it 20%. A null `change_7d`
  means zero momentum (factor 1.0).
- **Maturity (0.9–1.1):** `0.9 + 0.2 x min(days since listed_at, 1095) / 1095`.
  Older, large, still-tokenless protocols score higher. A null `listed_at`
  is neutral (factor 1.0), never penalised to zero.
- **Chains (capped):** `1 + 0.02 x min(chains - 1, 5)` — at most +10%.

### Why the median, not the mean

The ratios the multiples come from are violently skewed. Across the 128
token-bearing protocols with mcap data, the global mean mcap/TVL is 5.0386
against a median of 0.2138 — the mean is 24x the median. One protocol's
ratio reaches 400.20, and 36 of the 128 ratios sit above 1. A mean multiple
would let a handful of tiny-TVL, high-mcap outliers set the price of a whole
category:

| Category | Median multiple | Mean multiple | Max ratio |
| --- | --- | --- | --- |
| CEX | 0.0748 | 7.8246 | 69.42 |
| Basis Trading | 0.6544 | 5.6424 | 36.17 |
| Lending | 0.1324 | 1.8349 | 18.96 |
| Dexs | 0.3424 | 1.0747 | 3.18 |
| (global) | 0.2138 | 5.0386 | 400.20 |

The median is the middle protocol's ratio: it moves only when the typical
protocol in the category moves, and it is the value a new token in that
category would most plausibly resemble. The sensitivity test below measures
what the mean would have cost — re-ranking with mean multiples moves 194 of
198 rows by a median of 26 ranks.

### Sensitivity test

The ranking was re-run four times, changing a single modelling choice per
run. The mean multiple is the only choice that matters; the three small
factors are nudges, as designed:

| Variant | Changed | Rank correlation | Top 10 kept | Median move | Max move | Rows moved |
| --- | --- | --- | --- | --- | --- | --- |
| mean-multiple | mean mcap/TVL instead of median | 0.7875 | 7 / 10 | 26 | 89 | 194 / 198 |
| no-momentum | momentum factor off | 0.9989 | 10 / 10 | 1 | 15 | 138 / 198 |
| no-maturity | maturity factor off | 0.9981 | 10 / 10 | 2 | 11 | 156 / 198 |
| no-chains | chains factor off | 0.9995 | 10 / 10 | 1 | 9 | 135 / 198 |

Rank correlation is Spearman between the variant ranking and the base
ranking over all 198 rows. The full sensitivity table is in `board.json`
(`sensitivity`) and in the dashboard's methodology section.

### Where the value sits

The board rolled up by category (33 categories; full table in `board.json`
as `category_summary`, and as a panel on the dashboard — select a row to
filter the board to that category). Risk Curators alone hold over two-fifths
of the board's implied value:

| Category | Protocols | Total TVL | Total implied | Share | Watchlist | Top protocol |
| --- | --- | --- | --- | --- | --- | --- |
| Risk Curators | 34 | $9,271,881,010 | $2,097,264,742 | 42.8% | 12 | Steakhouse Financial (#1) |
| Onchain Capital Allocator | 18 | $2,922,697,424 | $673,227,773 | 13.8% | 3 | Veda (#4) |
| RWA | 16 | $1,501,354,730 | $417,982,475 | 8.5% | 7 | OnRe (#10) |
| Basis Trading | 8 | $488,800,667 | $325,675,601 | 6.7% | 2 | BitFi Basis (#6) |
| Dexs | 21 | $669,250,085 | $212,888,977 | 4.3% | 1 | Bittensor dTAO (#8) |

The composite score (0–100) is the log of the implied value rescaled between
the board's min and max, so ranking by score and ranking by implied value
always agree. The implied value is this entry's own claim, never make.fun's,
and it is not a prediction that a token will launch.

### Farm plans

Each row carries 3 steps tailored to its category — Dexs: swap / provide
liquidity / stake LP; Lending: supply / borrow / repay; Derivatives: open /
manage / close positions; vaults: deposit / hold / compound — naming the
protocol's own chains and saying what each step costs and how long it takes.

## Layout

```
main.ts                  the program (Node 22, stdlib only)
vendor/makefun-board.ts  the scorer's dossier library, byte for byte from the kit
dashboard/               index.html, app.css, app.js — static, no network requests
screenshots/             board, detail, filtered, methodology (rendered headless)
```

`board.json` also carries `category_summary` (the per-category roll-up) and
`sensitivity` (the four one-choice-changed re-runs), and the dashboard
renders both — the category panel above the board, the sensitivity table in
the methodology section.

## License

MIT — see LICENSE.
