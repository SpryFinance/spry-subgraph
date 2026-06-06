# Spry Subgraph

A [Graph](https://thegraph.com) subgraph for **Spry**: Uniswap V4 plus **one**
custom hook (`SpryHook`). It is a focused fork of the official
[Uniswap/v4-subgraph](https://github.com/Uniswap/v4-subgraph): ~90% of it
(pools, positions, ticks, tokens, swaps, liquidity, TVL/volume, day/hour
aggregates) is inherited verbatim, with targeted additions to (a) index **only
Spry pools**, (b) surface Spry's headline metric, the **per-swap dynamic fee**,
and (c) index the hook's own **`SpryFee`** event: the signed block-windowed
cumulative, the curve zone, and the dispatch case.

> **Status:** testnet-first, **pre-deployment**. Hook/router addresses and the
> start block are clearly-marked placeholders. See
> [Configure for your deployment](#configure-for-your-deployment).

---

## Quick start

```bash
git clone <repo-url> spry-subgraph && cd spry-subgraph
yarn install
yarn build      # = graph codegen && graph build  (compiles to ./build)
yarn test       # 79 matchstick unit tests   (no Docker needed: npx graph test)
```

`yarn build` and `yarn test` work out of the box against the placeholder config.
Before deploying to a real network, set your addresses (one `src/utils/spry.ts`
edit + one `networks.json` edit). See
[Configure for your deployment](#configure-for-your-deployment) and
[Build & deploy](#build--deploy).

---

## What is Spry?

Spry deploys a single hook (`SpryHook`) on top of the **canonical, unmodified**
Uniswap V4 `PoolManager` and `PositionManager`. A **Spry pool** is simply a V4
pool whose:

- `hooks` field equals the **SpryHook address**, and
- `fee` field is the V4 **dynamic-fee sentinel** `0x800000` (`DYNAMIC_FEE_FLAG`).

On every swap, `SpryHook.beforeSwap` returns a per-swap LP fee (OR-ed with
`OVERRIDE_FEE_FLAG` `0x400000`); V4 applies it and emits the resolved fee in the
`Swap` event's `fee` field. Because the V4 core is unchanged, the bulk of the
Uniswap subgraph applies as-is.

Each Spry pool also has a **tier**, determined solely by its `tickSpacing`:

| tickSpacing | tier         | base fee | cap fee | base pips | cap pips |
| ----------: | ------------ | -------: | ------: | --------: | -------: |
|           1 | `STABLE`     |    0.01% |   0.50% |       100 |     5000 |
|          10 | `LIKE_ASSET` |    0.05% |   1.00% |       500 |    10000 |
|          60 | `BLUE_CHIP`  |    0.30% |   5.50% |      3000 |    55000 |
|         200 | `VOLATILE`   |    0.50% |   9.00% |      5000 |    90000 |
|        1000 | `EXOTIC`     |    1.00% |   9.90% |     10000 |    99000 |

> Fees are in **V4 pips**: `1,000,000 pips = 100%`. The dynamic flag `0x800000`
> is **never** presented as a literal `8388608` bps; pools are flagged
> `isDynamicFee` and the per-swap fee is used instead.

---

## Configure for your deployment

Spry is pre-mainnet, so addresses are left as clearly-marked placeholders. There
are **two** places to edit:

### 1. `src/utils/spry.ts`: the Spry-specific addresses

This is the single source of truth for the values only you know:

```ts
// PLACEHOLDER: the deployed SpryHook address (lowercase). Until set to a real
// address, the subgraph indexes NOTHING (the default 0xff… matches no contract).
export const SPRY_HOOK_ADDRESS = '0xffffffffffffffffffffffffffffffffffffffff'

// PLACEHOLDER (optional): Spry's swap-only router, used only to tag swaps with
// `viaSpryRouter`. Leave as-is if you don't run one.
export const SPRY_ROUTER_ADDRESS = '0xffffffffffffffffffffffffffffffffffffffff'
```

### 2. `networks.json`: the canonical V4 contracts, the hook, + start block

The PoolManager / PositionManager are the **canonical** V4 deployments per
network. `SpryHook` is the hook **data source** (it listens to the `SpryFee`
event). `startBlock` should be the **SpryHook deploy block** (no Spry pool
exists before it). Testnet presets are provided (`base-sepolia`, `sepolia`,
`unichain-sepolia`):

```json
"base-sepolia": {
  "PoolManager":     { "address": "0x05E7…3408", "startBlock": 19088197 },
  "PositionManager": { "address": "0x4b2c…ca80", "startBlock": 19088197 },
  "SpryHook":        { "address": "0xffff…ffff", "startBlock": 19088197 }
}
```

> ⚠️ **The hook address appears in two synced places** and must match: the
> `SpryHook` entry in `networks.json` (the data source that listens to `SpryFee`)
> **and** `SPRY_HOOK_ADDRESS` in `src/utils/spry.ts` (used by the Initialize
> filter, which runs in the PoolManager context and can't read the hook data
> source's address). Set both to the same value at deploy.

> The `network:` in `subgraph.yaml` must be one of the networks defined in
> `src/utils/chains.ts` (the inherited multi-chain pricing config). The provided
> testnets already exist there.

The default committed `subgraph.yaml` targets `base-sepolia`. To retarget,
either edit it directly or regenerate it from `networks.json`:

```bash
yarn generate-subgraph sepolia      # rewrites subgraph.yaml for the named network
# graph-cli's native flag also works: `graph build --network sepolia`
```

---

## Build & deploy

```bash
yarn install
yarn codegen          # graph codegen: generates ./src/types from schema + ABIs
yarn build            # graph codegen && graph build: compiles mappings to WASM
yarn test             # matchstick unit tests (see "Testing" below)

# deploy (example: Alchemy / Satsuma hosted)
graph deploy <SUBGRAPH_NAME> \
  --node https://subgraphs.alchemy.com/api/subgraphs/deploy \
  --ipfs https://ipfs.satsuma.xyz \
  --network base-sepolia
```

`graph codegen` and `graph build` both pass, and `schema.graphql` is valid.

### Deploy to Goldsky

[Goldsky](https://goldsky.com) hosts standard graph-cli subgraphs, so this is the
**same** subgraph and codebase (no fork, no separate manifest); only the deploy
target differs. One-time setup: install the CLI (`curl https://goldsky.com | sh`)
and run `goldsky login` with an API key from the Goldsky dashboard. Then:

```bash
yarn deploy:goldsky                       # build + deploy current manifest, version from package.json
yarn deploy:goldsky 1.0.0                 # explicit version  -> spry-subgraph/1.0.0
yarn deploy:goldsky 1.0.0 base-sepolia    # retarget a networks.json network first, then deploy
```

That runs [`scripts/deploy-goldsky.sh`](scripts/deploy-goldsky.sh), which does
`graph codegen` + `graph build` then `goldsky subgraph deploy <name>/<version>
--path .`. The `network:` in `subgraph.yaml` must be a Goldsky-supported network
(these overlap heavily with The Graph's network slugs).

---

## What changed vs `v4-subgraph`

The diff is intentionally small and reviewable. Everything else (pricing/TVL,
ticks, positions, tokens, day/hour scaffolding, liquidity math) is inherited
**unchanged**, including `src/utils/chains.ts`, `pricing.ts`, `token.ts`,
`tick.ts`, and `liquidityMath/*`.

### Added

| File                                       | Why                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `src/utils/spry.ts`                        | Spry constants (hook/router addrs, fee flags) + helpers: `tierFromTickSpacing`, `feePipsToPercent`, `isDynamicFee`, `cleanFeePips`, `zoneName`, `dispatchCaseName`. |
| `abis/SpryHook.json`                       | The `SpryFee` event ABI (the hook's only event), for the SpryHook data source.                   |
| `src/mappings/spryFee.ts` + `spryHook.mapping.ts` | `handleSpryFee`: records `SpryFeeObservation`/`SpryFeeWindow`, zone/case distributions, and the `SpryFeePending` hand-off. |
| `src/mappings/donate.ts`                   | `Donate` handler (the upstream had none) that records donations on Spry pools.                    |
| `tests/handlers/handleInitializeSpry.test.ts`, `handleSpryFee.test.ts` | Spry filter (non-Spry hook / static fee / bad tickSpacing skipped) + tier; the `SpryFee`↔`Swap` join. |
| `queries.graphql`                          | The example queries below.                                                                        |

### Modified

| File                                  | Change                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.graphql`                      | `enum PoolTier`/`SpryZone`/`SpryDispatchCase`; `Pool` tier + dynamic-fee stats + zone/case counters + `last*`; `Swap.fee/feePercent/feeAmountUSD/viaSpryRouter` + `spryFee/cum*/zone/dispatchCase/windowId`; new `Tier`, `Donate`, `SpryFeeObservation`, `SpryFeeWindow`, `SpryFeePending` entities; dynamic-fee fields on `PoolDayData`/`PoolHourData`. Removed `EulerSwapHook`/`ArrakisHook`. |
| `src/mappings/poolManager.ts`         | **Initialize**: filter to `hooks == SPRY_HOOK_ADDRESS` **AND `fee == 0x800000`** AND a valid Spry `tickSpacing`; derive `tier`/`baseFeePips`/`capFeePips`; non-sentinel `feeTier`; init Tier + zone/case counters. Removed the Tempo stable-stable branch. |
| `src/mappings/swap.ts`                | Removed `HookSwap`/aggregator paths. Source the per-swap fee from the paired `SpryFee`; maintain pool `min/max/last/avg` fee stats + `feesUSD`; roll into `PoolDayData`/`PoolHourData` and `Tier`; attach `spryFee/cum*/zone/dispatchCase/windowId` and consume the `SpryFeePending` hand-off. |
| `src/mappings/modifyLiquidity.ts`     | Removed the aggregator-hook TVL branch, leaving the standard V4 TVL path only.                                                                     |
| `src/utils/intervalUpdates.ts`        | Initialize the new `PoolDayData`/`PoolHourData` dynamic-fee accumulators.                                                                          |
| `src/mappings/poolManager.mapping.ts` | Export `handleDonate`; drop `handleHookSwap`.                                                                                                      |
| `subgraph.yaml` / `networks.json` / `scripts/generate-subgraph.ts` | **Three** data sources: PoolManager (incl. `Donate`), PositionManager, **SpryHook (`SpryFee`)**; testnet + placeholders; foreign data sources removed. |
| `package.json`                        | Renamed to `spry-subgraph`.                                                                                                                        |
| `tests/handlers/*`                    | Pools created through the dynamic-fee Spry filter (fixtures use `0x800000`); assert tier + dynamic-fee + zone/case fields; `SpryFee`↔`Swap` join test. Fixed a pre-existing upstream `isExternalLiquidity` gap and a non-idempotent TVL assertion. |

### Removed

`src/mappings/{arrakis,euler}.{ts,mapping.ts}` and
`abis/{AggregatorHook,ArrakisHookFactory,EulerSwapFactory}.json`. These index
**other** protocols' hooks and are irrelevant to Spry.

---

## How the filtering works

`handleInitialize` is the only place that creates a `Pool`. It creates one only
when **all three** hold (per the contracts team's spec):

```
hooks == SPRY_HOOK_ADDRESS  AND  fee == 0x800000  AND  tickSpacing ∈ {1,10,60,200,1000}
```

The `fee == 0x800000` check matters: V4 only applies the hook's fee override when
the pool is dynamic-fee, so a static-fee pool merely *pointed at* SpryHook is not
a Spry pool. A bad `tickSpacing` reverts in the hook (`InvalidTier`), so such
pools are dead. Every other handler (`Swap`, `ModifyLiquidity`, `Donate`,
`SpryFee`) bails when `Pool.load(id)` is `null`, so the entire subgraph is
automatically scoped to Spry pools, with no per-handler address checks needed.

---

## Indexing the hook: the `SpryFee` event

`SpryHook` emits one `SpryFee` event per Spry swap, inside `beforeSwap`,
**immediately before** V4's own `Swap` event for the same pool/hop in the same
tx. It carries the hook's internal state, which is otherwise invisible:

```solidity
event SpryFee(
    PoolId indexed id,
    int256 cumBefore,     // signed block-windowed cumulative, pre-swap
    int256 cumAfter,      // post-swap (== the pool's persisted signedCum)
    uint24 fee,           // resolved LP fee in pips (OVERRIDE flag stripped)
    uint8  zone,          // 0 safe / 1 alert / 2 danger / 3 cap (of cumAfter)
    uint8  dispatchCase,  // 0 Growth / 1 Unwind / 2 Flip
    uint64 windowId       // the active window's start block
);
```

**Pairing `SpryFee` ↔ `Swap`.** The Graph fires handlers in `(block, logIndex)`
order across **all** data sources, so `handleSpryFee` always runs immediately
before the matching `handleSwap`. `handleSpryFee` records the observation and
writes a tiny `SpryFeePending` hand-off keyed by pool id; the next `handleSwap`
on that pool consumes it (and deletes it), attaching the rich fields onto the
`Swap` and sourcing the per-swap fee from `SpryFee.fee`. This is exact, handles
multi-hop (one pair per hop), and needs no log-index arithmetic.

**Fee source.** `Swap.fee` is taken from the paired `SpryFee.fee` (the
authoritative LP fee). It equals the V4 `Swap` event fee while the protocol fee
is 0 (confirmed for Spry pools). If a V4 protocol fee is ever enabled, the LP
analytics stay correct because they use the hook's LP fee; the difference
`PoolManager Swap.fee - SpryFee.fee` would be the protocol cut.

**What lights up.** `SpryFeeObservation` (per swap), `SpryFeeWindow` (cumulative
trajectory per block-window: `cumOpen/cumLast/cumMin/cumMax`), zone & dispatch
distributions on `Pool` and `Tier` (`safe/alert/danger/capCount`,
`growth/unwind/flipCount`), and `Pool.lastCum/lastZone/lastDispatchCase`.

> The tier table (tickSpacing → base/cap fee, zones) is **hardcoded**: the
> contracts confirm it's immutable `pure` constants with no setter/upgrade path,
> so it can't drift. (`SpryHook.tierParams(uint8)` is also `pure` and available
> via `eth_call` if you ever want the full zone bounds, but we don't need it.)

---

## Schema additions (quick reference)

- **`Pool`**: `tier` (`PoolTier`), `baseFeePips`, `capFeePips`, `isDynamicFee`,
  `lastFeePips`, `minFeePips`, `maxFeePips`, `swapCount`, `sumFeePips`,
  `feeWeightedVolumeUSD`, `avgFeePips` (volume-weighted), `donates`.
  Plus SpryFee rollups: `spryObservationCount`, zone counters
  `safe/alert/danger/capCount`, case counters `growth/unwind/flipCount`, and
  `lastCum/lastZone/lastDispatchCase/lastWindowId`.
  `feeTier` tracks the **current** fee (tier base fee at init, then the last
  per-swap fee), never the `0x800000` sentinel. `feesUSD` is total LP fees earned.
- **`Swap`**: `fee` (pips, from `SpryFee`), `feePercent` (`fee/10000`),
  `feeAmountUSD`, `viaSpryRouter`, plus the paired hook data: `spryFee` (link),
  `cumBefore`, `cumAfter`, `zone`, `dispatchCase`, `windowId`.
- **`Tier`**: per-tier aggregate keyed by name: `poolCount`, `swapCount`,
  `volumeUSD`, `feesUSD`, `min/max/avgFeePips`, base/cap fees, `tickSpacing`,
  zone/case counters.
- **`SpryFeeObservation`** (one per swap): `cumBefore/cumAfter`, `fee/feePercent`,
  `zone`, `dispatchCase`, `windowId`, pool/tier/window/tx links.
- **`SpryFeeWindow`** (per pool per `windowId`): `cumOpen/cumLast/cumMin/cumMax`,
  `swapCount`: the block-window cumulative trajectory.
- **`PoolDayData` / `PoolHourData`**: `min/max/lastFeePips`, `swapCount`,
  `sumFeePips`, `feeWeightedVolumeUSD`, `avgFeePips` for the window.
- **`Donate`**: pool, tokens, sender, amounts, `amountUSD`.

---

## Example queries

See [`queries.graphql`](queries.graphql) for the runnable versions:

1. **Top Spry pools by volume**: `TopSpryPoolsByVolume`
2. **A pool's recent swaps with per-swap dynamic fee**: `PoolRecentSwaps`
3. **Avg / min / max dynamic fee per pool**: `PoolDynamicFeeStats`
4. **Volume & avg fee by tier**: `VolumeAndAvgFeeByTier`
5. **Daily dynamic-fee trend for a pool**: `PoolDailyFeeTrend`
6. **An LP's positions**: `LpPositions`
7. **Zone & dispatch-case distribution (per pool & per tier)**: `ZoneAndCaseDistribution`
8. **A pool's cumulative trajectory by block-window**: `PoolWindowTrajectory`
9. **Recent swaps with the hook's signed cumulative & zone**: `PoolRecentSpryObservations`

---

## Provenance & confirmations

Built against `SpryFinance/spry-contracts @ main` (solc 0.8.26, v4-core `46c6834`,
v4-periphery `9dafaae`). The contracts team confirmed, and this subgraph relies
on:

- **The hook emits `SpryFee`**, so the previously-unindexable internals (the
  signed block-windowed cumulative, the curve zone, the dispatch case) are now
  **fully indexed**, not proxied. This is the headline change in this revision.
- **Protocol fee = 0** on Spry pools, so `Swap.fee == SpryFee.fee` (pure LP fee).
  We still source the LP fee from `SpryFee.fee`, so if the V4 admin ever turns on
  a protocol fee, LP analytics stay correct (and the gap vs `PoolManager Swap.fee`
  would be the protocol cut; watch `ProtocolFeeUpdated` if you need it).
- **Canonical, unmodified V4 core**: `OVERRIDE_FEE_FLAG` is stripped before the
  `Swap` event, so the fee is a clean pip value.
- **Tier table immutable**: hardcoded `pure` constants, no setter/upgrade path,
  so the hardcoded tier→fee table can't drift.
- **Single, immutable, non-upgradeable hook** (no proxy, one per chain), so the
  hook address is hardcoded per network (no registry needed).

What is **intentionally not** indexed (by the contracts team's design, not an
omission):

- **Router attribution** is best-effort only. `Swap.sender` is the immediate
  caller (a router), and any V4-aware router/aggregator can swap Spry pools, so
  `viaSpryRouter` only catches the configured `SPRY_ROUTER_ADDRESS`. Map known
  routers to labels off-chain. (An opt-in `SpryRoute(id,user,tag)` event could be
  added later for EOA-level attribution.)
- **Position → pool** linkage uses the canonical V4 convention `salt ==
  bytes32(tokenId)` (no extra event), exactly like Uniswap's v4-subgraph.

---

## Testing

```bash
yarn test        # graph test -d   (Docker + matchstick)
# or, without Docker:
npx graph test   # downloads the matchstick binary and runs in-process
```

All unit tests pass (79/79), including the inherited Uniswap tests, the Spry
filter / tier / dynamic-fee tests, the `SpryFee`↔`Swap` join (single, multi-hop,
and window-rollover), the `Donate` handler, pure `spry.ts` helper coverage (all
5 tiers, the fee-flag math, and the zone/case enum maps), and multi-swap fee
aggregation. Note: two
tests were failing in the **pristine upstream** repo (a missing
`isExternalLiquidity` in the test pool factory, and a swap TVL assertion that
re-derived prices through a non-idempotent path); both are fixed here.
