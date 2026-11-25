# Token Radar — which pre-token protocol is worth farming next?

Built for the [token-radar-01 bounty on make.fun](https://make.fun/c/token-radar-01):
build the best token launch radar. The program reads a sealed DefiLlama
snapshot, ranks the protocols that record no token by what a token launch
would be worth, and writes a dashboard a reader can actually use — board,
detail view, filters, farm plans, methodology.

## What it ranks

198 protocols. Every protocol in the snapshot that passes the tokenless
filter: it records no token (both `gecko_id` and `symbol` are null), its
name carries no version marker, its category is not Bridge, Canonical
Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its name
carries no whole word `wrapped`, `staked` or `staking`, and it does not
begin with an exchange's name. That covers all 40 protocols on the
snapshot's watchlist, plus 158 more below the floor. Total implied value
across the board: $4.90B. Rank 1 is Steakhouse Financial ($641,480,719);
8 of the top 10 are on the watchlist.

A protocol "records no token" in DefiLlama's record. That is not proof it
has none — and the board's implied value is this entry's own claim, never
one make.fun makes. It does not predict whether or when a token is issued.

## The model

Implied value = TVL × multiple × momentum × maturity × chains.

- **Multiple.** For each category, the median market-cap-to-TVL ratio
  among token-bearing protocols in the snapshot with market-cap data
  (minimum 3 samples, otherwise the global median). One shared predicate,
  `isCalibratable` — market cap non-null and above 0, TVL non-null and
  above 0 — is used both by the calibration and by the diagnostics below,
  so the populations are provably identical in the code.
- **Momentum.** 1 + 0.004 × the 7-day TVL change, capped at ±50%.
  A null change means zero momentum (factor 1).
- **Maturity.** 0.9 + 0.2 × days since `listed_at`, capped at 3 years.
  Older, large, still-tokenless protocols score higher. A null listing
  date is neutral (factor 1), never penalised to zero.
- **Chains.** 1 + 0.02 per extra chain, capped at 5 extra chains.
- **Score.** The implied value on a log scale from 0 to 100: rank 1
  scores 100, the last row scores 0.

### Why the median, not the mean

The snapshot's mcap/TVL ratios are wildly skewed: the global mean is
5.0386 while the global median is 0.2138, and the largest ratio is
400.20. A mean would let one outlier set the multiple for every
protocol. The CEX category shows the same skew: mean 7.8246 against a
median of 0.0748. The median is the typical token-bearing protocol; the
mean is the outlier. That is why the mean-vs-median choice is the only
load-bearing one in the sensitivity test below.

### Calibration table

| Category | Multiple | Samples | Source |
|---|---:|---:|---|
| Basis Trading | 0.6544 | 7 | category |
| Bridge | 0.5567 | 6 | category |
| Canonical Bridge | 0.7464 | 8 | category |
| CDP | 0.1687 | 3 | category |
| CEX | 0.0748 | 9 | category |
| Cross Chain Bridge | 1.2205 | 4 | category |
| Dexs | 0.3424 | 11 | category |
| Indexes | 0.1477 | 3 | category |
| Lending | 0.1324 | 15 | category |
| Liquid Staking | 0.0406 | 9 | category |
| Privacy | 0.9691 | 3 | category |
| RWA | 0.2748 | 9 | category |
| Yield | 0.1914 | 9 | category |
| Yield Aggregator | 0.1510 | 4 | category |
| (global fallback) | 0.2138 | 128 | global |

The global figures come from the same 128 calibratable protocols:
median 0.2138, mean 5.0386, max ratio 400.2045.

### Category summary

33 categories are on the board. Risk Curators is the largest at 42.8% of
total implied value (34 protocols, top: Steakhouse Financial), followed by
Onchain Capital Allocator at 13.8% and RWA at 8.5%. A category's "share of
implied value" is a share of this board's total implied value. It is
**not** a probability that any protocol launches a token.

### Sensitivity: what moves the ranking?

The program re-ranks the whole board four times from the snapshot, one
choice changed per run:

| Variant | Spearman | Top-10 overlap | Median move | Max move |
|---|---:|---:|---:|---:|
| mean-multiple | 0.7875 | 7 / 10 | 26 | 89 |
| no-momentum | 0.9989 | 10 / 10 | 1 | 15 |
| no-maturity | 0.9981 | 10 / 10 | 2 | 11 |
| no-chains | 0.9995 | 10 / 10 | 1 | 9 |

Only the mean-vs-median choice moves the board (194 of 198 rows change
rank). Momentum, maturity and chains are nudges: the top 10 is untouched
without any one of them.

### Limitations

- No shrinkage: a category with only 3 samples uses its median directly.
- No out-of-sample predictive validation: nothing here is tested against
  launches that happened after the snapshot.
- Sensitivity measures stability of the ranking under changed
  assumptions, not predictive accuracy.
- Categories with fewer than 3 calibrating samples fall back to the
  global median.

## Farm plans

Every row carries a 3-step farm plan tailored to its category (DEX
swap/LP, lending supply/borrow/repay, derivatives open/manage/close,
vault deposit/hold/compound, CDP open/hold/repay, RWA buy/hold/review,
and more), naming the protocol's own chains. Every step states a cost
and a time: gas ("gas is a few dollars"), how long the action takes
("takes minutes"), how long to hold ("at least 30 days", "2-4 weeks"),
and the exit condition (stop-loss, health factor above 1.5, withdrawal
fee, never exit early). Amounts are small on purpose: $25-$100 to try,
$50-$250 to commit.

## Dashboard

`dashboard/` is a static page with no network requests. The hero shows
the board's key numbers (198 protocols, 40 watchlist, total implied
value, global median multiple); the ranked board sits directly below
it; the category summary panel sits below the board — click a category
row to filter the board (click again to reset, it combines with search
and the chain filter, and "All categories" resets it). Click any board
row for its detail view and farm plan. The methodology section documents
the model, the calibration table, the sensitivity test and the
limitations above.

## Running it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Node 22 or later, standard library only. The program is deterministic:
two runs write byte-identical outputs. It empties the output
directory's contents before writing, and never deletes the output
directory itself.

## Files

- `main.ts` — the program (entrypoint)
- `dashboard/` — the static dashboard (`index.html`, `app.css`, `app.js`)
- `screenshots/` — board, detail, filtered and methodology views
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte
- `board.json`, `dossier.json` — written by the program into the output
  directory (not committed as build artefacts; see the output of a run)

## License

MIT. See `LICENSE`.
