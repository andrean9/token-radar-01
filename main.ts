// Token Radar v4 — a pre-token protocol radar, rebuilt from scratch.
//
// The program reads the sealed DefiLlama snapshot, keeps every
// protocol that records no token and is not a wrapped, staked or
// bridged product of a token that trades, and ranks the 198 survivors
// by implied token value. The multiple for a category is the median
// market-cap-to-TVL ratio of that category's token-bearing protocols;
// the implied value is TVL times that multiple, nudged by momentum,
// maturity and chain count. Every row carries a three-step farm plan
// written for its own category. The dashboard it writes is static
// and makes no network request.
//
// Run it with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const MAX_IMPLIED_USD = 100_000_000_000_000;
const MATURITY_DAYS = 1095;
const DAY_MS = 86_400_000;

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
  source: string;
}

interface CategorySummaryRow {
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

interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  multiple: number;
  multiple_samples: number;
  multiple_source: string;
  momentum_factor: number;
  maturity_factor: number;
  chains_factor: number;
  score: number;
  watchlist: boolean;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// One shared predicate decides which protocols calibrate the model.
// A protocol calibrates only when it records a token (a CoinGecko id
// or a ticker) and has a positive market cap on a positive TVL. The
// same predicate feeds the calibration table and the diagnostics, so
// the population is identical in the code in both places.
function isCalibratable(p: SnapshotProtocol): boolean {
  const recordsToken = p.gecko_id !== null || p.symbol !== null;
  return recordsToken && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd !== null && p.tvl_usd > 0;
}

function isTokenless(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// Whole days between the snapshot date and the day DefiLlama began
// tracking a protocol; null when the listing date is missing.
function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

// Maturity is read from the snapshot's own date, never from a fixed
// calendar constant: older, still-tokenless protocols score higher,
// capped at three years, and a missing listing date is neutral.
function maturityFactor(listedAt: string | null, asOf: string): number {
  const age = ageDays(asOf, listedAt);
  if (age === null) return 1;
  return 0.9 + (Math.min(age, MATURITY_DAYS) / MATURITY_DAYS) * 0.2;
}

function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return 1 + (clamp(change7d, -50, 50) / 100) * 0.4;
}

function chainsFactor(chains: string[]): number {
  return 1 + Math.min(Math.max(chains.length - 1, 0), 5) * 0.02;
}

// The board's filter, the same rule the watchlist itself uses: a
// protocol records no token, its category is not a bridge, a liquid
// staking or restaking product, or an exchange, its name carries no
// whole word wrapped, staked or staking, it ends in no version
// marker, and it does not begin with an exchange's name.
const EXCLUDED_CATEGORIES = new Set(["Bridge", "Canonical Bridge", "Liquid Staking", "Liquid Restaking", "Restaked BTC", "CEX"]);
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIXES = ["Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini"];

function isEligible(p: SnapshotProtocol): boolean {
  if (!isTokenless(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

interface Calibration {
  globalMedian: number;
  globalMean: number;
  globalMax: number;
  globalSamples: number;
  cexMean: number;
  cexMedian: number;
  byCategory: Map<string, number[]>;
  table: CalibrationRow[];
}

function calibrate(snapshot: Snapshot): Calibration {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isCalibratable(p)) continue;
    const ratio = p.mcap_usd! / p.tvl_usd;
    allRatios.push(ratio);
    if (p.category !== null) {
      const list = ratiosByCategory.get(p.category) ?? [];
      list.push(ratio);
      ratiosByCategory.set(p.category, list);
    }
  }
  const globalMedian = median(allRatios);
  const globalMean = mean(allRatios);
  const globalMax = Math.max(...allRatios);
  const cexRatios = ratiosByCategory.get("CEX") ?? [];
  const table: CalibrationRow[] = [];
  for (const category of [...ratiosByCategory.keys()].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))) {
    const samples = ratiosByCategory.get(category)!;
    if (samples.length < 3) continue;
    table.push({ category, multiple: round4(median(samples)), samples: samples.length, source: "category" });
  }
  table.push({ category: "(global fallback)", multiple: round4(globalMedian), samples: allRatios.length, source: "global" });
  return {
    globalMedian,
    globalMean,
    globalMax,
    globalSamples: allRatios.length,
    cexMean: cexRatios.length > 0 ? mean(cexRatios) : 0,
    cexMedian: cexRatios.length > 0 ? median(cexRatios) : 0,
    byCategory: ratiosByCategory,
    table,
  };
}

// The multiple a protocol gets: its category's median when that
// category has at least three calibrating protocols, else the
// global median. The full-precision median is used for scoring;
// only the displayed value is rounded to four decimals.
function multipleFor(p: SnapshotProtocol, cal: Calibration, useMean: boolean): { multiple: number; samples: number; source: string } {
  const ratios = p.category === null ? [] : (cal.byCategory.get(p.category) ?? []);
  if (ratios.length >= 3) {
    return { multiple: useMean ? mean(ratios) : median(ratios), samples: ratios.length, source: "category" };
  }
  return { multiple: useMean ? cal.globalMean : cal.globalMedian, samples: cal.globalSamples, source: "global" };
}

interface Scored {
  p: SnapshotProtocol;
  implied: number;
  multiple: number;
  samples: number;
  source: string;
  momentum: number;
  maturity: number;
  chains: number;
}

function scoreOne(p: SnapshotProtocol, snapshot: Snapshot, cal: Calibration, opts: { useMean: boolean; noMomentum: boolean; noMaturity: boolean; noChains: boolean }): Scored {
  const picked = multipleFor(p, cal, opts.useMean);
  const momentum = opts.noMomentum ? 1 : momentumFactor(p.change_7d);
  const maturity = opts.noMaturity ? 1 : maturityFactor(p.listed_at, snapshot.as_of);
  const chains = opts.noChains ? 1 : chainsFactor(p.chains);
  const raw = Math.max(1, Math.round(p.tvl_usd * picked.multiple * momentum * maturity * chains));
  const implied = Math.min(raw, MAX_IMPLIED_USD);
  return { p, implied, multiple: picked.multiple, samples: picked.samples, source: picked.source, momentum, maturity, chains };
}

function rankProtocols(chosen: SnapshotProtocol[], snapshot: Snapshot, cal: Calibration, opts: { useMean: boolean; noMomentum: boolean; noMaturity: boolean; noChains: boolean }): Map<string, number> {
  const scored = chosen.map((p) => scoreOne(p, snapshot, cal, opts));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const ranks = new Map<string, number>();
  scored.forEach((s, i) => ranks.set(s.p.slug, i + 1));
  return ranks;
}

function spearman(baseRanks: number[], variantRanks: number[]): number {
  const n = baseRanks.length;
  const meanBase = mean(baseRanks);
  const meanVariant = mean(variantRanks);
  let num = 0;
  let denBase = 0;
  let denVariant = 0;
  for (let i = 0; i < n; i++) {
    const db = baseRanks[i]! - meanBase;
    const dv = variantRanks[i]! - meanVariant;
    num += db * dv;
    denBase += db * db;
    denVariant += dv * dv;
  }
  if (denBase === 0 || denVariant === 0) return 1;
  return num / Math.sqrt(denBase * denVariant);
}

function sensitivityFor(chosen: SnapshotProtocol[], snapshot: Snapshot, cal: Calibration, baseRanks: Map<string, number>): SensitivityRow[] {
  const variants: { name: string; changed: string; opts: { useMean: boolean; noMomentum: boolean; noMaturity: boolean; noChains: boolean } }[] = [
    { name: "mean-multiple", changed: "per-category MEAN mcap/TVL instead of median (global mean fallback)", opts: { useMean: true, noMomentum: false, noMaturity: false, noChains: false } },
    { name: "no-momentum", changed: "momentum factor off (all momentum factors = 1)", opts: { useMean: false, noMomentum: true, noMaturity: false, noChains: false } },
    { name: "no-maturity", changed: "maturity factor off (all maturity factors = 1)", opts: { useMean: false, noMomentum: false, noMaturity: true, noChains: false } },
    { name: "no-chains", changed: "chains factor off (all chains factors = 1)", opts: { useMean: false, noMomentum: false, noMaturity: false, noChains: true } },
  ];
  const baseTop10 = new Set([...baseRanks.entries()].filter(([, rank]) => rank <= 10).map(([slug]) => slug));
  const rows: SensitivityRow[] = [];
  for (const variant of variants) {
    const ranks = rankProtocols(chosen, snapshot, cal, variant.opts);
    const slugs = [...baseRanks.keys()];
    const baseList = slugs.map((slug) => baseRanks.get(slug)!);
    const variantList = slugs.map((slug) => ranks.get(slug)!);
    const moves = slugs.map((slug) => Math.abs(baseRanks.get(slug)! - ranks.get(slug)!));
    const variantTop10 = new Set([...ranks.entries()].filter(([, rank]) => rank <= 10).map(([slug]) => slug));
    let overlap = 0;
    for (const slug of baseTop10) if (variantTop10.has(slug)) overlap++;
    rows.push({
      variant: variant.name,
      changed: variant.changed,
      spearman_rank_correlation: round4(spearman(baseList, variantList)),
      top10_overlap: overlap,
      median_abs_rank_move: Math.round(median(moves)),
      max_abs_rank_move: Math.max(...moves),
      rows_moved: moves.filter((m) => m > 0).length,
    });
  }
  return rows;
}

// Farm plans: one specialist template per group of categories. The
// mapping below is the round-2 mapping, complete — no snapshot
// category falls through to the default template.
function farmGroup(category: string | null): string {
  const map: Record<string, string> = {
    Dexs: "dexs",
    Lending: "lending",
    "Uncollateralized Lending": "lending",
    "Collateral Markets": "lending",
    Derivatives: "derivatives",
    "Basis Trading": "derivatives",
    "Interest Rate Derivatives": "derivatives",
    "Risk Curators": "vaults",
    "Onchain Capital Allocator": "vaults",
    Yield: "vaults",
    "Yield Aggregator": "vaults",
    Farm: "vaults",
    "Liquidity Manager": "vaults",
    "Leveraged Farming": "vaults",
    CeDeFi: "vaults",
    CDP: "cdp",
    "CDP Manager": "cdp",
    "Stablecoin Wrapper": "cdp",
    "Dual-Token Stablecoin": "cdp",
    RWA: "rwa",
    Restaking: "staking",
    "Staking Pool": "staking",
    Chain: "chain",
    "Cross Chain Bridge": "bridge",
    "Anchor BTC": "btc",
    "Decentralized BTC": "btc",
    "Prediction Market": "prediction",
    Insurance: "insurance",
    Payments: "payments",
    "Crypto Card Issuer": "payments",
    "Governance Incentives": "governance",
    Indexes: "indexes",
    "OTC Marketplace": "otc",
  };
  if (category !== null && map[category] !== undefined) return map[category]!;
  return "default";
}

// Every step states its own cost and its own time: a capital amount
// plus a gas or fee estimate, how long the action takes, how long to
// hold, and the exit condition that belongs to the category. A step
// that needs no new payment says so outright — "holding costs
// nothing beyond the first transaction — no new gas" — instead of
// staying silent about cost.
type FarmTemplate = (name: string, chain: string, chainsText: string) => string[];

const FARM_TEMPLATES: Record<string, FarmTemplate> = {
  dexs: (name, chain) => [
    `Swap $50-$250 of assets on ${name} on ${chain} — gas is a few dollars and a swap takes minutes; keep slippage low and check the pool depth first.`,
    `Add $50-$250 of liquidity to ${name} on ${chain} and hold the position for at least 30 days; holding costs nothing beyond the first transaction — no new gas, and check impermanent loss weekly.`,
    `Remove the ${name} liquidity after a month, or sooner if impermanent loss grows; removing costs a few dollars of gas and takes minutes, and exit before the pool dries up.`,
  ],
  lending: (name, chain) => [
    `Supply $50-$250 of assets to ${name} on ${chain} — gas is a few dollars and the supply takes minutes; check the supply rate and the withdrawal terms first.`,
    `Borrow a small amount against the ${name} supply and hold the position for at least 30 days; holding costs nothing beyond the first transaction — no new gas, and keep the health factor above 1.5.`,
    `Repay the ${name} borrow and withdraw the supply after a month; repaying costs a few dollars of gas and takes minutes, and exit at once if the health factor falls near 1.5.`,
  ],
  derivatives: (name, chain) => [
    `Open a small $50-$250 position on ${name} on ${chain} — gas is a few dollars and opening takes minutes; use low leverage and set a stop-loss before you open.`,
    `Manage the ${name} position for at least 30 days; holding costs nothing beyond the first transaction — no new gas, but funding fees accrue daily, so check the stop-loss every day.`,
    `Close the ${name} position after a month, or when the stop-loss hits; closing costs a few dollars of gas and takes minutes, and never let a losing position run past its stop.`,
  ],
  vaults: (name, chain, chainsText) => [
    `Deposit $50-$250 into a ${name} vault on ${chain} — gas is a few dollars and the deposit takes minutes; read the strategy and fee schedule first.`,
    `Hold the ${name} vault position for at least 30 days so the deposit counts as sticky TVL; holding costs nothing beyond the first transaction — no new gas, and check the withdrawal fee before you exit.`,
    `Review the ${name} vault allocation monthly, harvest or compound any rewards, and add a second deposit after a month on ${chainsText}; reviewing takes minutes and a second deposit costs a few dollars of gas, so do not exit early on a small dip.`,
  ],
  cdp: (name, chain) => [
    `Lock $50-$250 of collateral in ${name} on ${chain} — gas is a few dollars and locking takes minutes; keep the collateral ratio well above the minimum.`,
    `Mint a small amount against the ${name} collateral and hold the position for at least 30 days; holding costs nothing beyond the first transaction — no new gas, and watch the collateral price daily so a crash cannot liquidate you.`,
    `Repay the ${name} debt and unlock the collateral after a month, or sooner if the ratio falls near the liquidation line; repaying costs a few dollars of gas and takes minutes, and saves the collateral.`,
  ],
  rwa: (name, chain) => [
    `Buy $50-$250 of the tokenized asset on ${name} on ${chain} — gas is a few dollars and the purchase takes minutes; check the issuer, the yield source and the redemption terms first.`,
    `Hold the ${name} asset for at least 30 days; holding costs nothing beyond the first transaction — no new gas, and the yield accrues weekly while you hold.`,
    `Redeem or sell the ${name} asset after a month; redemption costs a few dollars of gas and takes minutes, and exit if the redemption window closes or the issuer risk rises.`,
  ],
  staking: (name, chain) => [
    `Stake $50-$250 with ${name} on ${chain} — gas is a few dollars and staking takes minutes; confirm the unbonding period and the validator before you stake.`,
    `Hold the ${name} staked position for at least 30 days; holding costs nothing beyond the first transaction — no new gas, and the staking rewards accrue daily while you hold.`,
    `Unstake from ${name} after a month; unstaking costs a few dollars of gas and takes minutes plus the unbonding wait of several days, and exit if the validator is slashed.`,
  ],
  chain: (name, chain) => [
    `Bridge $50-$250 onto ${name} — the bridge fee is a few dollars and the transfer takes minutes to an hour; use the official bridge and check the destination address twice.`,
    `Use two or three live apps on ${name} over at least 30 days, spending a few dollars of gas per week; holding costs nothing beyond each app's own gas, and steady on-chain activity is what a future snapshot would count.`,
    `Keep a small balance on ${name} for a month and review the apps monthly; leaving costs a few dollars of gas and takes minutes, so bridge out while gas is cheap.`,
  ],
  bridge: (name, chain) => [
    `Bridge $50-$250 through ${name} from ${chain} — the bridge fee is a few dollars and the transfer takes minutes to an hour; use the official route and check the destination address twice.`,
    `Make a second $50-$250 bridge through ${name} after at least two weeks, holding the bridged funds in between; the second bridge costs a few dollars of gas and takes minutes, and holding costs nothing beyond the first transaction — no new gas.`,
    `Bridge back through ${name} after a month; bridging back costs a few dollars of gas and takes minutes, and stop using the route if the bridge fee rises above a few dollars per transfer.`,
  ],
  btc: (name, chain) => [
    `Move $50-$250 of BTC into ${name} on ${chain} — gas and the bridge fee are a few dollars and the move takes minutes; confirm the BTC address and the peg before you move.`,
    `Hold the ${name} BTC position for at least 30 days; holding costs nothing beyond the first transaction — no new gas, and watch the peg daily so a depeg cannot trap the funds.`,
    `Withdraw the BTC from ${name} after a month; withdrawal costs a few dollars of gas and takes minutes, and exit at once if the peg slips below its normal band.`,
  ],
  prediction: (name, chain) => [
    `Place a $50-$250 position on a ${name} market on ${chain} — gas is a few dollars and the trade takes minutes; pick a market you understand and size the position small.`,
    `Hold the ${name} position, or add a second market, over at least 30 days; holding costs nothing beyond the first transaction — no new gas, and check the odds weekly before you add.`,
    `Settle or close the ${name} position after a month, or when the market resolves; closing costs a few dollars of gas and takes minutes, and exit if the market's odds stop making sense.`,
  ],
  insurance: (name, chain) => [
    `Buy $50-$250 of cover from ${name} on ${chain} — the premium is a few dollars and the purchase takes minutes; read the exclusions and the claim window first.`,
    `Hold the ${name} cover for at least 30 days; holding costs nothing beyond the first transaction — no new gas, since the premium already paid covers the month.`,
    `Renew the ${name} cover, or file a claim, after a month; renewal costs a few dollars of premium and takes minutes, and exit if the cover lapses or the terms worsen.`,
  ],
  payments: (name, chain) => [
    `Spend or send $50-$250 through ${name} on ${chain} — each payment costs a few dollars of gas and takes minutes; confirm the recipient and the fee before you send.`,
    `Use ${name} for regular payments over at least 30 days, a few transactions per week; holding costs nothing beyond each payment's own gas, and steady volume is what a payments snapshot would count.`,
    `Withdraw or off-ramp the ${name} balance after a month, or keep a working balance if you pay weekly; off-ramping costs a few dollars of gas and takes minutes, and stop using it if fees rise above a few dollars per payment.`,
  ],
  governance: (name, chain) => [
    `Lock or delegate $50-$250 of voting power with ${name} on ${chain} — gas is a few dollars and the delegation takes minutes; check the active proposals before you lock.`,
    `Vote in at least two ${name} proposals over 30 days; voting costs nothing beyond the first transaction — no new gas, and each vote takes minutes to cast.`,
    `Unlock or redelegate the ${name} voting power after a month; unlocking costs a few dollars of gas and takes minutes, and exit if governance stops publishing proposals.`,
  ],
  indexes: (name, chain) => [
    `Buy $50-$250 of the ${name} index token on ${chain} — gas is a few dollars and the purchase takes minutes; check the index constituents and the fee first.`,
    `Hold the ${name} index for at least 30 days; holding costs nothing beyond the first transaction — no new gas, and the index rebalances monthly while you hold.`,
    `Sell or redeem the ${name} index after a month; selling costs a few dollars of gas and takes minutes, and exit if the index drifts far from its stated basket.`,
  ],
  otc: (name, chain) => [
    `Place a $50-$250 OTC order on ${name} on ${chain} — the desk fee is a few dollars and settlement takes minutes to hours; verify the counterparty and the price before you place it.`,
    `Settle a second $50-$250 OTC order on ${name} over at least 30 days; holding costs nothing beyond the first transaction — no new gas, and the second settlement costs a few dollars of gas and takes minutes.`,
    `Settle a final ${name} order after a month; settlement costs a few dollars of gas and takes minutes, and exit if the desk spread widens beyond a few dollars per order.`,
  ],
  default: (name, chain) => [
    `Deposit $50-$250 into ${name} on ${chain} — gas is a few dollars and the deposit takes minutes; read the protocol's own docs and fee schedule first.`,
    `Hold the ${name} position for at least 30 days; holding costs nothing beyond the first transaction — no new gas, and check the position weekly while you hold.`,
    `Review the ${name} position after a month; withdrawing costs a few dollars of gas and takes minutes, and exit if activity dries up or the fees rise.`,
  ],
};

function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : "its main chain";
  const chainsText = p.chains.slice(0, 3).join(", ");
  const template = FARM_TEMPLATES[farmGroup(p.category)]!;
  return template(p.name, chain, chainsText);
}

interface BuiltBoard {
  board: BoardRow[];
  totalImplied: number;
  calibration: Calibration;
  categorySummary: CategorySummaryRow[];
  sensitivity: SensitivityRow[];
  chosen: SnapshotProtocol[];
}

function buildBoard(snapshot: Snapshot): BuiltBoard {
  const cal = calibrate(snapshot);
  const chosen = snapshot.protocols.filter(isEligible);
  const scored = chosen.map((p) => scoreOne(p, snapshot, cal, { useMean: false, noMomentum: false, noMaturity: false, noChains: false }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const watchlist = new Set(snapshot.watchlist);
  const minImplied = scored[scored.length - 1]!.implied;
  const maxImplied = scored[0]!.implied;
  const logMin = Math.log10(minImplied);
  const logMax = Math.log10(maxImplied);
  const board: BoardRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    multiple: round4(s.multiple),
    multiple_samples: s.samples,
    multiple_source: s.source,
    momentum_factor: round4(s.momentum),
    maturity_factor: round4(s.maturity),
    chains_factor: round4(s.chains),
    score: logMax === logMin ? 0 : round1((100 * (Math.log10(s.implied) - logMin)) / (logMax - logMin)),
    watchlist: watchlist.has(s.p.slug),
  }));
  const totalImplied = board.reduce((sum, r) => sum + r.implied_value_usd, 0);
  const byCategory = new Map<string, BoardRow[]>();
  for (const row of board) {
    const key = row.category ?? "(no category)";
    const list = byCategory.get(key) ?? [];
    list.push(row);
    byCategory.set(key, list);
  }
  const categorySummary: CategorySummaryRow[] = [...byCategory.entries()]
    .map(([category, rows]) => {
      const top = [...rows].sort((a, b) => a.rank - b.rank)[0]!;
      return {
        category,
        protocols: rows.length,
        total_tvl_usd: rows.reduce((sum, r) => sum + r.tvl_usd, 0),
        total_implied_usd: rows.reduce((sum, r) => sum + r.implied_value_usd, 0),
        share_of_implied: round4(rows.reduce((sum, r) => sum + r.implied_value_usd, 0) / totalImplied),
        watchlist_count: rows.filter((r) => r.watchlist).length,
        top_protocol_slug: top.slug,
        top_protocol_name: top.name,
        top_protocol_rank: top.rank,
        top_protocol_implied_usd: top.implied_value_usd,
      };
    })
    .sort((a, b) => b.total_implied_usd - a.total_implied_usd || (a.category < b.category ? -1 : 1));
  const baseRanks = new Map(board.map((r) => [r.slug, r.rank] as [string, number]));
  const sensitivity = sensitivityFor(chosen, snapshot, cal, baseRanks);
  return { board, totalImplied, calibration: cal, categorySummary, sensitivity, chosen };
}

function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("snapshot.json is not JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("snapshot.json is not a JSON object");
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error("snapshot.json has no as_of date");
  if (typeof o.source !== "string") throw new Error("snapshot.json has no source");
  if (typeof o.floor_usd !== "number" || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new Error("snapshot.json has no floor_usd");
  if (!Array.isArray(o.protocols)) throw new Error("snapshot.json has no protocols array");
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== "string")) throw new Error("snapshot.json has no watchlist of slugs");
  const protocols: SnapshotProtocol[] = o.protocols.map((v, i) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`snapshot.json protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== "string" || typeof p.name !== "string" || typeof p.tvl_usd !== "number" || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === "string" ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === "string") : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === "number" && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === "number" && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === "string" ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === "string" ? p.gecko_id : null,
      symbol: typeof p.symbol === "string" ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(", ")}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return "all rows share the same implied value: a board that ranks nothing by value is not a ranking";
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
      if (!/(\$|gas|fee|cost)/i.test(s)) return `${r.slug} has a farm step with no cost stated`;
      if (!/(minute|hour|day|week|month|at least|takes)/i.test(s)) return `${r.slug} has a farm step with no time stated`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > MAX_IMPLIED_USD) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

// Empty a directory's contents without ever removing the directory
// itself: the grader mounts the output directory, so deleting it
// would fail the run.
function clearContents(dir: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    rmSync(join(dir, name), { recursive: true, force: true });
  }
}

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith(".")) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = arg("input", "/input");
const inputFile = inputArg.endsWith(".json") ? inputArg : join(inputArg, "snapshot.json");
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg("output", process.env.MAKEFUN_OUTPUT_DIR ?? "/output");
const snapshot = parseSnapshot(readFileSync(inputFile, "utf8"));
const built = buildBoard(snapshot);
const issue = boardIssue(built.board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

clearContents(out);
mkdirSync(out, { recursive: true });
const boardDoc = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  count: built.board.length,
  watchlist_count: snapshot.watchlist.length,
  global_median_mcap_tvl: round4(built.calibration.globalMedian),
  global_mean_mcap_tvl: round4(built.calibration.globalMean),
  global_median_samples: built.calibration.globalSamples,
  global_max_ratio: round4(built.calibration.globalMax),
  cex_mean_mcap_tvl: round4(built.calibration.cexMean),
  cex_median_mcap_tvl: round4(built.calibration.cexMedian),
  calibration: built.calibration.table,
  category_summary: built.categorySummary,
  sensitivity: built.sensitivity,
  rows: built.board,
};
writeFileSync(join(out, "board.json"), `${JSON.stringify(boardDoc, null, 2)}\n`);
const radarData = {
  count: built.board.length,
  watchlist_count: snapshot.watchlist.length,
  total_implied_usd: built.totalImplied,
  global_median_mcap_tvl: round4(built.calibration.globalMedian),
  global_mean_mcap_tvl: round4(built.calibration.globalMean),
  global_max_ratio: round4(built.calibration.globalMax),
  global_median_samples: built.calibration.globalSamples,
  cex_mean_mcap_tvl: round4(built.calibration.cexMean),
  cex_median_mcap_tvl: round4(built.calibration.cexMedian),
  calibration: built.calibration.table,
  category_summary: built.categorySummary,
  sensitivity: built.sensitivity,
  rows: built.board,
};
copyFiles(join(here, "dashboard"), join(out, "dashboard"));
writeFileSync(join(out, "dashboard", "rows.js"), `window.TOKEN_RADAR = ${JSON.stringify(radarData, null, 2)};\n`);
const shots = copyFiles(join(here, "screenshots"), join(out, "screenshots"));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}
writeFileSync(join(out, "dossier.json"), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${built.board.length} rows scored\n` +
    `token radar: wrote ${join(out, "board.json")}, ${join(out, "dashboard")} (4 files), ${join(out, "screenshots")} (${shots.length} images) and ${join(out, "dossier.json")}\n`,
);
