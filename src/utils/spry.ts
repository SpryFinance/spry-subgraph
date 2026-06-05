import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'

/* ───────────────────────── Spry deployment constants ─────────────────────────
 *
 * Spry is Uniswap V4 + ONE custom hook (`SpryHook`) deployed on the canonical,
 * unmodified V4 PoolManager / PositionManager. A "Spry pool" is a V4 pool whose
 * `hooks` field == SPRY_HOOK_ADDRESS and whose `fee` field is the dynamic-fee
 * sentinel (0x800000).
 *
 * This file is the SINGLE place a deployer edits the Spry-specific addresses.
 * The canonical V4 PoolManager / PositionManager addresses and the start block
 * live in `networks.json` (and the generated `subgraph.yaml`).
 *
 * All addresses MUST be lowercase: they are compared against `*.toHexString()`,
 * which always returns lowercase hex.
 * ──────────────────────────────────────────────────────────────────────────── */

// PLACEHOLDER: replace with the deployed SpryHook address before deploying.
// Left as all-0xFF (a non-existent contract) on purpose: an unconfigured
// subgraph then indexes NOTHING, instead of silently indexing every hookless V4
// pool (which would be the case if this were the zero address, since plain V4
// pools have `hooks == 0x0`).
export const SPRY_HOOK_ADDRESS = '0xffffffffffffffffffffffffffffffffffffffff'

// PLACEHOLDER (optional): Spry's own swap-only router (`SpryRouter`). Used only
// to tag swaps with `viaSpryRouter` by comparing it to the Swap event `sender`.
// Leave as-is if you do not run / care about a dedicated router.
export const SPRY_ROUTER_ADDRESS = '0xffffffffffffffffffffffffffffffffffffffff'

/* ───────────────────────────── V4 fee flags ─────────────────────────────────
 * Fees in V4 are expressed in pips: 1,000,000 pips == 100%.
 *
 *   - DYNAMIC_FEE_FLAG marks a PoolKey.fee as dynamic. The actual LP fee is
 *     decided per-swap by the hook and emitted in the Swap event's `fee` field.
 *   - OVERRIDE_FEE_FLAG is OR-ed by the hook onto the fee it returns to tell V4
 *     to override the stored fee. V4 strips it before applying AND before
 *     emitting, so the Swap event's `fee` is already the clean, resolved fee.
 * ──────────────────────────────────────────────────────────────────────────── */
export const DYNAMIC_FEE_FLAG: i32 = 0x800000 // 8388608
export const OVERRIDE_FEE_FLAG: i32 = 0x400000 // 4194304
export const LP_FEE_MASK: i32 = 0x3fffff // low 22 bits, masks off both flags

export const PIPS_DENOMINATOR = BigDecimal.fromString('1000000') // 1e6 == 100%
export const PERCENT_DENOMINATOR = BigDecimal.fromString('10000') // pips -> percent

// `true` when a PoolKey.fee carries the V4 dynamic-fee sentinel (0x800000).
export function isDynamicFee(fee: i32): boolean {
  return fee == DYNAMIC_FEE_FLAG
}

// Strip the override / dynamic flags from a raw fee value. The V4 Swap event
// already emits the resolved fee, so this is a defensive no-op for real fees
// (every Spry tier cap is < OVERRIDE_FEE_FLAG); it only matters if a flagged
// value ever leaks through.
export function cleanFeePips(fee: i32): i32 {
  return fee & LP_FEE_MASK
}

// pips -> percentage number, e.g. 3000 pips -> 0.30 (read as 0.30%).
export function feePipsToPercent(feePips: BigInt): BigDecimal {
  return feePips.toBigDecimal().div(PERCENT_DENOMINATOR)
}

/* ─────────────────────────────── Spry tiers ─────────────────────────────────
 * A Spry pool's tier is determined SOLELY by its tickSpacing. A tickSpacing
 * outside this set is not a valid Spry pool (the hook would revert its swaps),
 * so the Initialize handler skips it.
 *
 *   tickSpacing  tier         base fee   cap fee     base pips   cap pips
 *      1         STABLE        0.01%      0.50%          100        5000
 *      10        LIKE_ASSET    0.05%      1.00%          500       10000
 *      60        BLUE_CHIP     0.30%      5.50%         3000       55000
 *      200       VOLATILE      0.50%      9.00%         5000       90000
 *      1000      EXOTIC        1.00%      9.90%        10000       99000
 * ──────────────────────────────────────────────────────────────────────────── */
export class TierInfo {
  name: string
  baseFeePips: BigInt
  capFeePips: BigInt

  constructor(name: string, baseFeePips: i32, capFeePips: i32) {
    this.name = name
    this.baseFeePips = BigInt.fromI32(baseFeePips)
    this.capFeePips = BigInt.fromI32(capFeePips)
  }
}

// Returns the Spry tier for a tickSpacing, or `null` if it is not a Spry tier.
export function tierFromTickSpacing(tickSpacing: i32): TierInfo | null {
  if (tickSpacing == 1) return new TierInfo('STABLE', 100, 5000)
  if (tickSpacing == 10) return new TierInfo('LIKE_ASSET', 500, 10000)
  if (tickSpacing == 60) return new TierInfo('BLUE_CHIP', 3000, 55000)
  if (tickSpacing == 200) return new TierInfo('VOLATILE', 5000, 90000)
  if (tickSpacing == 1000) return new TierInfo('EXOTIC', 10000, 99000)
  return null
}

/* ──────────────────── SpryFee event enum decoding ───────────────────────────
 * The SpryFee event encodes `zone` (uint8 0..3) and `dispatchCase` (uint8 0..2).
 * These map to the SpryZone / SpryDispatchCase GraphQL enums.
 * ──────────────────────────────────────────────────────────────────────────── */
export function zoneName(zone: i32): string {
  if (zone == 0) return 'SAFE'
  if (zone == 1) return 'ALERT'
  if (zone == 2) return 'DANGER'
  if (zone == 3) return 'CAP'
  return 'SAFE' // unreachable for valid SpryFee events
}

export function dispatchCaseName(dispatchCase: i32): string {
  if (dispatchCase == 0) return 'GROWTH'
  if (dispatchCase == 1) return 'UNWIND'
  if (dispatchCase == 2) return 'FLIP'
  return 'GROWTH' // unreachable for valid SpryFee events
}
