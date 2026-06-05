import { BigInt } from '@graphprotocol/graph-ts'

import { SpryFee as SpryFeeEvent } from '../types/SpryHook/SpryHook'
import { Pool, SpryFeeObservation, SpryFeePending, SpryFeeWindow, Tier } from '../types/schema'
import { ONE_BI, ZERO_BI } from '../utils/constants'
import { loadTransaction } from '../utils/index'
import { dispatchCaseName, feePipsToPercent, zoneName } from '../utils/spry'

// SpryHook emits `SpryFee` inside beforeSwap, immediately BEFORE V4's own `Swap`
// event for the same pool/hop in the same tx. The Graph fires handlers in
// (block, logIndex) order across all data sources, so this handler always runs
// before the matching `handleSwap`. We record the observation + window + pool/
// tier distributions here, and stash a `SpryFeePending` hand-off (keyed by pool
// id) that `handleSwap` consumes to attach the rich fields onto the Swap entity.
export function handleSpryFee(event: SpryFeeEvent): void {
  const poolId = event.params.id.toHexString()
  const pool = Pool.load(poolId)
  // Only tracked Spry pools (created by the Initialize filter) have a Pool entity.
  // A static-fee pool pointed at the hook (skipped at Initialize) is ignored.
  if (pool === null) {
    return
  }

  const zoneIdx = event.params.zone // i32, 0..3
  const caseIdx = event.params.dispatchCase // i32, 0..2
  const feePips = BigInt.fromI32(event.params.fee)
  const windowId = event.params.windowId // BigInt (uint64)
  const cumBefore = event.params.cumBefore // BigInt (int256)
  const cumAfter = event.params.cumAfter // BigInt (int256)
  const zoneStr = zoneName(zoneIdx)
  const caseStr = dispatchCaseName(caseIdx)

  const transaction = loadTransaction(event)
  const obsId = transaction.id + '-' + event.logIndex.toString()

  // ── per-pool-per-window cumulative trajectory ──
  const windowEntId = poolId + '-' + windowId.toString()
  let window = SpryFeeWindow.load(windowEntId)
  if (window === null) {
    window = new SpryFeeWindow(windowEntId)
    window.pool = pool.id
    window.tier = pool.tier
    window.windowId = windowId
    window.startBlock = windowId
    window.cumOpen = cumBefore
    window.cumMin = cumBefore
    window.cumMax = cumBefore
    window.swapCount = ZERO_BI
    window.createdAtTimestamp = event.block.timestamp
    window.createdAtBlockNumber = event.block.number
  }
  window.cumLast = cumAfter
  if (cumBefore.lt(window.cumMin)) window.cumMin = cumBefore
  if (cumAfter.lt(window.cumMin)) window.cumMin = cumAfter
  if (cumBefore.gt(window.cumMax)) window.cumMax = cumBefore
  if (cumAfter.gt(window.cumMax)) window.cumMax = cumAfter
  window.swapCount = window.swapCount.plus(ONE_BI)
  window.save()

  // ── the observation (immutable, one per swap) ──
  const obs = new SpryFeeObservation(obsId)
  obs.pool = pool.id
  obs.tier = pool.tier
  obs.window = windowEntId
  obs.transaction = transaction.id
  obs.timestamp = event.block.timestamp
  obs.blockNumber = event.block.number
  obs.logIndex = event.logIndex
  obs.cumBefore = cumBefore
  obs.cumAfter = cumAfter
  obs.fee = feePips
  obs.feePercent = feePipsToPercent(feePips)
  obs.zone = zoneStr
  obs.zoneId = zoneIdx
  obs.dispatchCase = caseStr
  obs.dispatchCaseId = caseIdx
  obs.windowId = windowId
  obs.save()

  // ── pool last-state + zone/case distributions ──
  pool.lastCum = cumAfter
  pool.lastZone = zoneStr
  pool.lastDispatchCase = caseStr
  pool.lastWindowId = windowId
  pool.spryObservationCount = pool.spryObservationCount.plus(ONE_BI)
  if (zoneIdx == 0) pool.safeCount = pool.safeCount.plus(ONE_BI)
  else if (zoneIdx == 1) pool.alertCount = pool.alertCount.plus(ONE_BI)
  else if (zoneIdx == 2) pool.dangerCount = pool.dangerCount.plus(ONE_BI)
  else if (zoneIdx == 3) pool.capCount = pool.capCount.plus(ONE_BI)
  if (caseIdx == 0) pool.growthCount = pool.growthCount.plus(ONE_BI)
  else if (caseIdx == 1) pool.unwindCount = pool.unwindCount.plus(ONE_BI)
  else if (caseIdx == 2) pool.flipCount = pool.flipCount.plus(ONE_BI)
  pool.save()

  // ── tier zone/case distributions ──
  const tier = Tier.load(pool.tier)
  if (tier !== null) {
    if (zoneIdx == 0) tier.safeCount = tier.safeCount.plus(ONE_BI)
    else if (zoneIdx == 1) tier.alertCount = tier.alertCount.plus(ONE_BI)
    else if (zoneIdx == 2) tier.dangerCount = tier.dangerCount.plus(ONE_BI)
    else if (zoneIdx == 3) tier.capCount = tier.capCount.plus(ONE_BI)
    if (caseIdx == 0) tier.growthCount = tier.growthCount.plus(ONE_BI)
    else if (caseIdx == 1) tier.unwindCount = tier.unwindCount.plus(ONE_BI)
    else if (caseIdx == 2) tier.flipCount = tier.flipCount.plus(ONE_BI)
    tier.save()
  }

  // ── hand-off for the immediately-following Swap on this pool ──
  let pending = SpryFeePending.load(poolId)
  if (pending === null) {
    pending = new SpryFeePending(poolId)
  }
  pending.observation = obsId
  pending.cumBefore = cumBefore
  pending.cumAfter = cumAfter
  pending.fee = feePips
  pending.zone = zoneStr
  pending.dispatchCase = caseStr
  pending.windowId = windowId
  pending.save()
}
