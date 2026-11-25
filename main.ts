// token-radar-01 — rebuild from scratch (round 3 replacement, no submit).
//
// Reads the frozen DefiLlama snapshot, ranks every qualifying tokenless
// protocol by an implied token value, and writes board.json, the dashboard
// data, the dashboard itself, screenshots and dossier.json into the output
// directory (MAKEFUN_OUTPUT_DIR, default "out").
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//
// Node 22+, standard library only. Deterministic: two runs on the same
// input write byte-identical outputs (no timestamps, no randomness, stable
// sort with a slug tie-break).
//
// ---- The model (documented in full; see README.md and the dashboard) ----
//
// Calibration. For every category, the multiple is the MEDIAN mcap/TVL
// ratio of the token-bearing protocols in the same snapshot that carry a
// positive market cap (mcap_usd > 0) and a positive TVL, requiring at least
// 3 samples. A category with fewer samples falls back to the global median
// across all such protocols. The median — not the mean — is the calibration
// statistic, because the ratio distribution is grotesquely skewed: on this
// snapshot the global mean is 5.0386 against a median of 0.2138, with a
// single protocol at 400.20 pulling the mean up ~24x. A mean multiple would
// value every tokenless protocol as if it were the average of a distribution
// dominated by two or three outliers (see the sensitivity run: swapping the
// median for the mean moves 194 of 198 ranks, median move 26 places).
// CEX shows the same skew inside one category: mean 7.8246, median 0.0748.
//
// Implied value. implied_value_usd = TVL x multiple x momentum x maturity
// x chains, rounded to whole dollars. The four factors:
//
//   momentum = 1 + 0.004 * clamp(change_7d, -50, +50)
//     A 7-day TVL change, capped at +/-50% so one viral week cannot dominate.
//     Null change_7d means zero momentum (factor 1), never a penalty.
//   maturity = clamp(1 + (age_years - 1.5) / 15, 0.9, 1.1)
//     Age in years since listed_at against the snapshot date. Older, large,
//     still-tokenless protocols score higher: a protocol that survived years
//     at size without launching a token is the interesting case. Null
//     listed_at is neutral (factor 1), never penalised to zero.
//   chains = 1 + 0.02 * min(max(n_chains - 1, 0), 5)
//     Chain diversification, capped at +10% (6+ chains).
//
// Ranking. Rows sort by implied value, descending; ties break by slug
// ascending. The displayed score is the min-max normalisation of
// log10(implied value) across the board, 0-100 with one decimal, so the
// top row scores 100 and the bottom 0. Because the score is a monotone
// transform of the implied value, rank order and implied-value order agree.
//
// Farm plan. Three steps per row, tailored to the protocol's category and
// naming its own chains (see farmSteps below).
//
// Sensitivity (section C). The ranking is re-run four times, changing one
// choice per run — mean instead of median multiples, momentum off, maturity
// off, chains off — and each variant is compared with the base ranking by
// Spearman rank correlation, top-10 overlap, and median / max absolute
// rank move. The mean multiple is the only load-bearing choice.

import * as fs from "node:fs";
import * as path from "node:path";
import { buildDossier } from "./vendor/makefun-board.ts";

// ---------------------------------------------------------------- types ---

interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

interface CalibrationRow {
  category: string;
  multiple: number;
  samples: number;
  source: "category" | "global";
}

interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  multiple: number;
  multiple_samples: number;
  multiple_source: "category" | "global";
  momentum_factor: number;
  maturity_factor: number;
  chains_factor: number;
  score: number;
  watchlist: boolean;
}

interface CategorySummary {
  category: string;
  protocols: number;
  total_tvl_usd: number;
  total_implied_usd: number;
  share_of_implied: number;
  watchlist_count: number;
  top_protocol_slug: string;
  top_protocol_name: string;
  top_protocol_rank: number;
  top_protocol_implied_usd: number;
}

interface SensitivityRow {
  variant: string;
  changed: string;
  spearman_rank_correlation: number;
  top10_overlap: number;
  median_abs_rank_move: number;
  max_abs_rank_move: number;
  rows_moved: number;
}

// ------------------------------------------------------------- constants ---

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];
const MIN_CATEGORY_SAMPLES = 3;
const MOMENTUM_CAP = 50;
const MOMENTUM_RATE = 0.004;
const MATURITY_PIVOT_YEARS = 1.5;
const MATURITY_SLOPE = 1 / 15;
const MATURITY_MIN = 0.9;
const MATURITY_MAX = 1.1;
const CHAINS_STEP = 0.02;
const CHAINS_CAP_STEPS = 5;

// ---------------------------------------------------------------- helpers ---

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) throw new Error("median of empty set");
  return n % 2 === 1
    ? sorted[(n - 1) / 2]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso + "T00:00:00Z");
  const to = Date.parse(toIso + "T00:00:00Z");
  return Math.round((to - from) / 86400000);
}

/** Spearman rank correlation between two rank assignments over one slug set. */
function spearman(baseRank: Map<string, number>, variantRank: Map<string, number>): number {
  const slugs = [...baseRank.keys()];
  const n = slugs.length;
  const meanRank = (n + 1) / 2;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (const slug of slugs) {
    const a = baseRank.get(slug)! - meanRank;
    const b = variantRank.get(slug)! - meanRank;
    num += a * b;
    denA += a * a;
    denB += b * b;
  }
  return num / Math.sqrt(denA * denB);
}

// ------------------------------------------------------- tokenless filter ---

/**
 * The tokenless filter, applied to every protocol at or above $5M TVL
 * (the snapshot already only carries those). A protocol qualifies when it
 * records no token (gecko_id and symbol both null), its name carries no
 * version marker, its category is not a bridge / staking / CEX bucket, its
 * name carries no whole word wrapped / staked / staking, and it does not
 * begin with an exchange name. Mirrors the watchlist definition in the
 * kit's input/README.md; the watchlist itself is the floor subset of this
 * same filter (TVL >= $50M).
 */
function isTokenless(p: SnapshotProtocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  const words = p.name.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.includes("wrapped") || words.includes("staked") || words.includes("staking")) {
    return false;
  }
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

// ------------------------------------------------------------ calibration ---

interface Calibration {
  byCategory: Map<string, number>;
  meanByCategory: Map<string, number>;
  samplesByCategory: Map<string, number>;
  globalMedian: number;
  globalMean: number;
  globalSamples: number;
  table: CalibrationRow[];
}

/**
 * Median mcap/TVL per category over token-bearing protocols with a
 * positive market cap and TVL. A market cap of -1 (one record in this
 * snapshot carries a negative mcap) is data noise, not a ratio, so the
 * sample set requires mcap_usd > 0. Categories with fewer than 3 samples
 * fall back to the global median.
 */
function calibrate(protocols: SnapshotProtocol[]): Calibration {
  const byCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd === null) continue;
    if (!(p.mcap_usd > 0) || !(p.tvl_usd > 0)) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRatios.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  const globalMedian = median(allRatios);
  const globalMean = mean(allRatios);
  const multiples = new Map<string, number>();
  const means = new Map<string, number>();
  const samples = new Map<string, number>();
  const table: CalibrationRow[] = [];
  for (const [category, ratios] of [...byCategory.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (ratios.length >= MIN_CATEGORY_SAMPLES) {
      multiples.set(category, median(ratios));
      means.set(category, mean(ratios));
      samples.set(category, ratios.length);
      table.push({
        category,
        multiple: round4(median(ratios)),
        samples: ratios.length,
        source: "category",
      });
    }
  }
  table.push({
    category: "(global fallback)",
    multiple: round4(globalMedian),
    samples: allRatios.length,
    source: "global",
  });
  return {
    byCategory: multiples,
    meanByCategory: means,
    samplesByCategory: samples,
    globalMedian,
    globalMean,
    globalSamples: allRatios.length,
    table,
  };
}

function multipleFor(
  category: string | null,
  cal: Calibration,
): { multiple: number; samples: number; source: "category" | "global" } {
  if (category !== null && cal.byCategory.has(category)) {
    return {
      multiple: cal.byCategory.get(category)!,
      samples: cal.samplesByCategory.get(category)!,
      source: "category",
    };
  }
  return { multiple: cal.globalMedian, samples: cal.globalSamples, source: "global" };
}

// ----------------------------------------------------------------- factors ---

function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return 1 + MOMENTUM_RATE * clamp(change7d, -MOMENTUM_CAP, MOMENTUM_CAP);
}

function maturityFactor(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 1;
  const ageYears = daysBetween(listedAt, asOf) / 365;
  return clamp(1 + (ageYears - MATURITY_PIVOT_YEARS) * MATURITY_SLOPE, MATURITY_MIN, MATURITY_MAX);
}

function chainsFactor(chains: string[]): number {
  return 1 + CHAINS_STEP * Math.min(Math.max(chains.length - 1, 0), CHAINS_CAP_STEPS);
}

// -------------------------------------------------------------- farm plan ---

/**
 * Three farm steps per protocol, tailored to its category and naming its
 * own chains. Each step is a concrete on-chain action a reader can take
 * today (deposit / supply / swap / stake / open), a holding rule that
 * makes the activity count as sticky usage, and a follow-up that keeps the
 * position alive. Amounts are illustrative starter sizes, never advice to
 * deploy more than the reader can afford to lose.
 */
function farmSteps(p: SnapshotProtocol): string[] {
  const name = p.name;
  const chainList = p.chains.slice(0, 3).join(", ");
  const chainWord = p.chains.length > 1 ? "chains" : "chain";
  const firstChain = p.chains[0] ?? "its home chain";
  const cat = p.category ?? "";

  // [open, hold, follow-up] verb triples per category family.
  const plans: Record<string, [string, string, string]> = {
    Dexs: [
      `Swap $25-$100 of volume on ${name} on ${firstChain}, using a limit order when the pair supports one, and keep the receipt hash for the record.`,
      `Provide liquidity to the busiest ${name} pool on ${firstChain} with $50-$250 for at least 30 days so the position counts as sticky liquidity.`,
      `Check the ${name} pool weekly, harvest any fees or points, and add a second deposit after a month on ${chainList}.`,
    ],
    Lending: [
      `Supply $50-$250 of collateral to ${name} on ${firstChain}, starting with a blue-chip asset and a conservative loan-to-value.`,
      `Keep the supplied position open for at least 30 days and hold the health factor above 2 so the loan never risks liquidation.`,
      `Borrow a small amount against the collateral, repay it in full, then re-supply on ${chainList} to show repeat usage.`,
    ],
    Yield: [
      `Deposit $50-$250 into a ${name} vault on ${firstChain}, after confirming the vault strategy, fees and withdrawal terms.`,
      `Hold the ${name} vault position for at least 30 days so the deposit counts as sticky TVL; yields accrue continuously.`,
      `Check the vault weekly, harvest or compound any rewards, and add a second deposit after a month on ${chainList}.`,
    ],
    "Yield Aggregator": [
      `Deposit $50-$250 into a ${name} vault on ${firstChain}, after confirming the vault strategy, fees and withdrawal terms.`,
      `Hold the ${name} vault position for at least 30 days so the deposit counts as sticky TVL; yields accrue continuously.`,
      `Check the vault weekly, harvest or compound any rewards, and add a second deposit after a month on ${chainList}.`,
    ],
    "Risk Curators": [
      `Deposit $50-$250 into a ${name} curated vault on ${firstChain}, after reading the curator strategy and fee schedule.`,
      `Hold the ${name} vault position for at least 30 days so the deposit counts as sticky TVL with a named curator.`,
      `Review the curator allocation monthly, harvest any rewards, and add a second deposit after a month on ${chainList}.`,
    ],
    "Onchain Capital Allocator": [
      `Allocate $50-$250 through ${name} on ${firstChain}, after reading the allocation mandate and fee schedule.`,
      `Hold the ${name} allocation for at least 30 days so the capital counts as sticky TVL under management.`,
      `Review the allocation report monthly, harvest or compound any yield, and top up after a month on ${chainList}.`,
    ],
    CDP: [
      `Open a collateralised position on ${name} on ${firstChain} with $50-$250 of collateral, minting only a small fraction of the maximum.`,
      `Hold the ${name} position for at least 30 days and keep the collateral ratio well above the liquidation line.`,
      `Repay part of the minted amount, then mint again after a month on ${chainList} to show sustained borrowing activity.`,
    ],
    Derivatives: [
      `Open a small hedged position on ${name} on ${firstChain} with $25-$100 of margin, using a stop loss from the start.`,
      `Manage the ${name} position for at least two weeks, closing and reopening once, so the activity reads as a real trader.`,
      `Try a second market on ${name} after a month, keeping total margin small on ${chainList}.`,
    ],
    "Basis Trading": [
      `Open a small basis position on ${name} on ${firstChain} with $25-$100, after reading how the funding and spot legs work.`,
      `Hold the ${name} basis position for at least two weeks, tracking the funding rate daily so the trade stays hedged.`,
      `Close the position, then reopen a fresh one after a month on ${chainList} to show repeat usage.`,
    ],
    RWA: [
      `Buy $50-$250 of the tokenised asset on ${name} on ${firstChain}, after confirming the underlying asset and redemption terms.`,
      `Hold the ${name} position for at least 30 days so the holding counts as sticky TVL in a real-world asset.`,
      `Check the asset report monthly and add a second purchase after a month on ${chainList}.`,
    ],
    "Staking Pool": [
      `Stake $50-$250 with ${name} on ${firstChain}, after confirming the lock-up, fees and unstaking delay.`,
      `Keep the ${name} stake active for at least 30 days so the stake counts as sticky, long-term participation.`,
      `Claim or compound staking rewards monthly and consider a second stake after a month on ${chainList}.`,
    ],
    Restaking: [
      `Restake $50-$250 of liquid staking tokens through ${name} on ${firstChain}, after confirming the operators and slashing terms.`,
      `Keep the ${name} restake active for at least 30 days so the position counts as sticky restaked capital.`,
      `Review operator performance monthly and add a second restake after a month on ${chainList}.`,
    ],
    "Prediction Market": [
      `Place a $10-$50 prediction on ${name} on ${firstChain} in a market you understand, after reading the resolution rules.`,
      `Hold the ${name} position until resolution, then claim any winnings and record the outcome for your own log.`,
      `Place a second prediction in a different market after a month on ${chainList}.`,
    ],
    "Liquidity Manager": [
      `Deposit $50-$250 into a ${name} managed liquidity position on ${firstChain}, after confirming the range strategy and fees.`,
      `Hold the ${name} position for at least 30 days so the liquidity counts as sticky managed TVL.`,
      `Check the range weekly, rebalance when the manager suggests it, and add a second deposit after a month on ${chainList}.`,
    ],
    "Leveraged Farming": [
      `Open a small leveraged farm on ${name} on ${firstChain} with $25-$100, keeping leverage low and a stop in place.`,
      `Monitor the ${name} farm daily for at least two weeks, topping up collateral before the health factor falls.`,
      `Close the farm, take profit or cut the loss, then open a fresh small farm after a month on ${chainList}.`,
    ],
    "Cross Chain Bridge": [
      `Bridge $25-$100 to ${firstChain} through ${name}, after confirming the destination address, fee and arrival time.`,
      `Use the bridged funds in a ${name}-supported action on the destination chain within a week so the bridge is not a dead hop.`,
      `Bridge back a smaller amount after a month on ${chainList} to show two-way usage.`,
    ],
    Payments: [
      `Make a $10-$50 payment through ${name} on ${firstChain}, confirming the recipient address and fee before sending.`,
      `Repeat the ${name} payment at least twice more over the next month so the activity reads as a real user.`,
      `Try a second payment rail on ${name} after a month on ${chainList}.`,
    ],
    Insurance: [
      `Buy $25-$100 of cover on ${name} on ${firstChain} for a protocol you already use, after reading the cover terms.`,
      `Hold the ${name} cover for its full term and keep the policy receipt; a claim, if ever needed, is the point of cover.`,
      `Renew or buy cover for a second protocol after a month on ${chainList}.`,
    ],
    Indexes: [
      `Buy $50-$250 of the ${name} index on ${firstChain}, after reading the index composition and rebalancing rules.`,
      `Hold the ${name} index position for at least 30 days so the holding counts as sticky index TVL.`,
      `Review the index rebalance monthly and add a second purchase after a month on ${chainList}.`,
    ],
    Farm: [
      `Deposit $50-$250 into a ${name} farm on ${firstChain}, after confirming the reward token, lock-up and fees.`,
      `Hold the ${name} farm position for at least 30 days so the deposit counts as sticky farmed TVL.`,
      `Harvest rewards weekly, compound when gas allows, and add a second deposit after a month on ${chainList}.`,
    ],
    "Stablecoin Wrapper": [
      `Wrap $50-$250 into the ${name} stablecoin on ${firstChain}, after confirming the peg mechanism and redemption path.`,
      `Hold the wrapped ${name} balance for at least 30 days, using it in one real payment or deposit.`,
      `Unwrap a small amount and re-wrap after a month on ${chainList} to show two-way usage.`,
    ],
    "Collateral Markets": [
      `Supply $50-$250 of collateral to a ${name} market on ${firstChain}, starting with a blue-chip asset.`,
      `Keep the ${name} collateral supplied for at least 30 days and watch the market utilisation weekly.`,
      `Borrow a small amount against it, repay in full, then re-supply after a month on ${chainList}.`,
    ],
  };

  const triple = plans[cat] ?? [
    `Use ${name} on ${firstChain} with $25-$100, after reading how the protocol works and what its fees are.`,
    `Keep the ${name} position active for at least 30 days so the activity counts as sticky usage on the ${chainWord} ${chainList}.`,
    `Return after a month, repeat the core action on ${name}, and record the transaction hashes for your own log.`,
  ];
  return [...triple];
}

// ---------------------------------------------------------------- ranking ---

interface RankedProtocol extends SnapshotProtocol {
  multiple: number;
  multipleSamples: number;
  multipleSource: "category" | "global";
  momentum: number;
  maturity: number;
  chainsF: number;
  implied: number;
}

/** Score one protocol under the given calibration overrides. */
function rankAll(
  qualified: SnapshotProtocol[],
  asOf: string,
  cal: Calibration,
  overrides: {
    useMean?: boolean;
    noMomentum?: boolean;
    noMaturity?: boolean;
    noChains?: boolean;
  } = {},
): RankedProtocol[] {
  const ranked: RankedProtocol[] = qualified.map((p) => {
    let multiple: number;
    let samples: number;
    let source: "category" | "global";
    if (overrides.useMean) {
      // Sensitivity variant: per-category MEAN (global mean fallback).
      if (p.category !== null && cal.meanByCategory.has(p.category)) {
        multiple = cal.meanByCategory.get(p.category)!;
        samples = cal.samplesByCategory.get(p.category)!;
        source = "category";
      } else {
        multiple = cal.globalMean;
        samples = cal.globalSamples;
        source = "global";
      }
    } else {
      const m = multipleFor(p.category, cal);
      multiple = m.multiple;
      samples = m.samples;
      source = m.source;
    }
    const momentum = overrides.noMomentum ? 1 : momentumFactor(p.change_7d);
    const maturity = overrides.noMaturity ? 1 : maturityFactor(p.listed_at, asOf);
    const chainsF = overrides.noChains ? 1 : chainsFactor(p.chains);
    return {
      ...p,
      multiple,
      multipleSamples: samples,
      multipleSource: source,
      momentum,
      maturity,
      chainsF,
      implied: Math.round(p.tvl_usd * multiple * momentum * maturity * chainsF),
    };
  });
  ranked.sort((a, b) => b.implied - a.implied || a.slug.localeCompare(b.slug));
  return ranked;
}

// ---------------------------------------------------------- main program ---

function parseArgs(argv: string[]): { input: string; outputDir: string } {
  let input = process.env["MAKEFUN_INPUT"] ?? "/input/snapshot.json";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) input = argv[++i];
  }
  const outputDir = process.env["MAKEFUN_OUTPUT_DIR"] ?? "out";
  return { input, outputDir };
}

/** Remove every entry inside a directory, never the directory itself. */
function clearDirContents(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function buildSensitivity(
  qualified: SnapshotProtocol[],
  asOf: string,
  cal: Calibration,
  base: RankedProtocol[],
): SensitivityRow[] {
  const baseRank = new Map(base.map((r, i) => [r.slug, i + 1]));
  const baseTop10 = new Set(base.slice(0, 10).map((r) => r.slug));
  const variants: Array<{
    variant: string;
    changed: string;
    overrides: Parameters<typeof rankAll>[3];
  }> = [
    {
      variant: "mean-multiple",
      changed: "per-category MEAN mcap/TVL instead of median (global mean fallback)",
      overrides: { useMean: true },
    },
    {
      variant: "no-momentum",
      changed: "momentum factor off (all momentum factors = 1)",
      overrides: { noMomentum: true },
    },
    {
      variant: "no-maturity",
      changed: "maturity factor off (all maturity factors = 1)",
      overrides: { noMaturity: true },
    },
    {
      variant: "no-chains",
      changed: "chains factor off (all chains factors = 1)",
      overrides: { noChains: true },
    },
  ];
  return variants.map((v) => {
    const ranked = rankAll(qualified, asOf, cal, v.overrides);
    const variantRank = new Map(ranked.map((r, i) => [r.slug, i + 1]));
    const moves = [...baseRank.keys()].map((slug) =>
      Math.abs(baseRank.get(slug)! - variantRank.get(slug)!),
    );
    const sortedMoves = [...moves].sort((a, b) => a - b);
    const variantTop10 = new Set(ranked.slice(0, 10).map((r) => r.slug));
    let overlap = 0;
    for (const slug of baseTop10) if (variantTop10.has(slug)) overlap++;
    return {
      variant: v.variant,
      changed: v.changed,
      spearman_rank_correlation: round4(spearman(baseRank, variantRank)),
      top10_overlap: overlap,
      median_abs_rank_move: sortedMoves[Math.floor(sortedMoves.length / 2)],
      max_abs_rank_move: Math.max(...moves),
      rows_moved: moves.filter((m) => m > 0).length,
    };
  });
}

function main(): void {
  const { input, outputDir } = parseArgs(process.argv.slice(2));
  const repoRoot = path.dirname(new URL(import.meta.url).pathname);
  const snapshot: Snapshot = JSON.parse(fs.readFileSync(input, "utf-8"));
  const watchlist = new Set(snapshot.watchlist);

  const qualified = snapshot.protocols.filter(isTokenless);
  const cal = calibrate(snapshot.protocols);
  const ranked = rankAll(qualified, snapshot.as_of, cal);

  // Score: min-max normalisation of log10(implied value), 0-100, 1 decimal.
  const logMin = Math.log10(ranked[ranked.length - 1].implied);
  const logMax = Math.log10(ranked[0].implied);
  const rows: BoardRow[] = ranked.map((r, i) => ({
    slug: r.slug,
    name: r.name,
    rank: i + 1,
    implied_value_usd: r.implied,
    farm_steps: farmSteps(r),
    category: r.category ?? "Uncategorised",
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    listed_at: r.listed_at,
    multiple: round4(r.multiple),
    multiple_samples: r.multipleSamples,
    multiple_source: r.multipleSource,
    momentum_factor: round4(r.momentum),
    maturity_factor: round4(r.maturity),
    chains_factor: round4(r.chainsF),
    score: Math.round((100 * (Math.log10(r.implied) - logMin)) / (logMax - logMin) * 10) / 10,
    watchlist: watchlist.has(r.slug),
  }));

  // Category summary: one row per category, ordered by total implied value.
  const byCat = new Map<string, BoardRow[]>();
  for (const row of rows) {
    const list = byCat.get(row.category) ?? [];
    list.push(row);
    byCat.set(row.category, list);
  }
  const totalImplied = rows.reduce((a, r) => a + r.implied_value_usd, 0);
  const categorySummary: CategorySummary[] = [...byCat.entries()]
    .map(([category, list]) => {
      const top = list[0];
      return {
        category,
        protocols: list.length,
        total_tvl_usd: list.reduce((a, r) => a + r.tvl_usd, 0),
        total_implied_usd: list.reduce((a, r) => a + r.implied_value_usd, 0),
        share_of_implied: 0, // filled below, after sorting
        watchlist_count: list.filter((r) => r.watchlist).length,
        top_protocol_slug: top.slug,
        top_protocol_name: top.name,
        top_protocol_rank: top.rank,
        top_protocol_implied_usd: top.implied_value_usd,
      };
    })
    .sort((a, b) => b.total_implied_usd - a.total_implied_usd);
  for (const c of categorySummary) {
    c.share_of_implied = round4(c.total_implied_usd / totalImplied);
  }

  const sensitivity = buildSensitivity(qualified, snapshot.as_of, cal, ranked);

  // Mean / median diagnostics for the methodology section (why median).
  const cexRatios = snapshot.protocols
    .filter((p) => p.category === "CEX" && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd);
  const allRatios = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd);

  const board = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    count: rows.length,
    watchlist_count: rows.filter((r) => r.watchlist).length,
    global_median_mcap_tvl: round4(cal.globalMedian),
    global_mean_mcap_tvl: round4(cal.globalMean),
    global_median_samples: cal.globalSamples,
    global_max_ratio: round4(Math.max(...allRatios)),
    cex_mean_mcap_tvl: round4(mean(cexRatios)),
    cex_median_mcap_tvl: round4(median(cexRatios)),
    calibration: cal.table,
    category_summary: categorySummary,
    sensitivity,
    rows,
  };

  // ---- write outputs (clear contents only; never delete the output dir) ---
  clearDirContents(outputDir);
  fs.writeFileSync(path.join(outputDir, "board.json"), JSON.stringify(board, null, 2) + "\n");

  const dashOut = path.join(outputDir, "dashboard");
  copyDir(path.join(repoRoot, "dashboard"), dashOut);
  const dashboardData = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      count: rows.length,
      watchlist_count: board.watchlist_count,
      global_median_mcap_tvl: board.global_median_mcap_tvl,
      global_mean_mcap_tvl: board.global_mean_mcap_tvl,
      global_median_samples: cal.globalSamples,
      global_max_ratio: board.global_max_ratio,
      cex_mean_mcap_tvl: board.cex_mean_mcap_tvl,
      cex_median_mcap_tvl: board.cex_median_mcap_tvl,
    },
    calibration: cal.table,
    category_summary: categorySummary,
    sensitivity,
    rows,
  };
  // Pretty-printed so the dossier text (capped at 65,536 bytes, cut at a
  // line boundary) carries as much of the board data as possible instead
  // of stopping at one 160 KB line.
  fs.writeFileSync(
    path.join(dashOut, "rows.js"),
    "window.TOKEN_RADAR = " + JSON.stringify(dashboardData, null, 2) + ";\n",
  );

  copyDir(path.join(repoRoot, "screenshots"), path.join(outputDir, "screenshots"));

  const dossier = buildDossier(outputDir, { text_max_bytes: 65536 });
  fs.writeFileSync(path.join(outputDir, "dossier.json"), Buffer.from(dossier));

  console.log(
    `token-radar-01 rebuild: ${rows.length} rows, ` +
      `${board.watchlist_count}/${snapshot.watchlist.length} watchlist, ` +
      `${categorySummary.length} categories, ` +
      `global median ${board.global_median_mcap_tvl} (mean ${board.global_mean_mcap_tvl}), ` +
      `dossier ${dossier.length} bytes -> ${outputDir}`,
  );
}

main();
