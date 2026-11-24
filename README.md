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

## License

MIT — see LICENSE.
