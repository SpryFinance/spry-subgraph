import { BigDecimal, BigInt, store } from '@graphprotocol/graph-ts'

import { Swap as SwapEvent } from '../types/PoolManager/PoolManager'
import { Bundle, Pool, PoolManager, SpryFeePending, Swap, Tier, Token } from '../types/schema'
import { getSubgraphConfig, SubgraphConfig } from '../utils/chains'
import { ONE_BI, ZERO_BD } from '../utils/constants'
import { convertTokenToDecimal, loadTransaction, safeDiv } from '../utils/index'
import {
  updatePoolDayData,
  updatePoolHourData,
  updateTokenDayData,
  updateTokenHourData,
  updateUniswapDayData,
} from '../utils/intervalUpdates'
import {
  findNativePerToken,
  getNativePriceInUSD,
  getTrackedAmountUSD,
  sqrtPriceX96ToTokenPrices,
} from '../utils/pricing'
import { cleanFeePips, feePipsToPercent, getSpryRouterAddress } from '../utils/spry'

export function handleSwap(event: SwapEvent): void {
  handleSwapHelper(event)
}

export function handleSwapHelper(
  event: SwapEvent,
  subgraphConfig: SubgraphConfig = getSubgraphConfig(),
  // Spry router address is injectable so tests can supply their own fixture router.
  spryRouterAddress: string = getSpryRouterAddress(),
): void {
  const poolManagerAddress = subgraphConfig.poolManagerAddress
  const stablecoinWrappedNativePoolId = subgraphConfig.stablecoinWrappedNativePoolId
  const stablecoinIsToken0 = subgraphConfig.stablecoinIsToken0
  const wrappedNativeAddress = subgraphConfig.wrappedNativeAddress
  const stablecoinAddresses = subgraphConfig.stablecoinAddresses
  const minimumNativeLocked = subgraphConfig.minimumNativeLocked
  const whitelistTokens = subgraphConfig.whitelistTokens
  const nativeTokenDetails = subgraphConfig.nativeTokenDetails

  const poolId = event.params.id.toHexString()
  const pool = Pool.load(poolId)

  // Only Spry pools have a Pool entity (created by the Initialize filter). A null
  // pool means this is not a Spry pool (or no Spry pool exists yet). Skip it
  // BEFORE touching the global Bundle / PoolManager: those are created lazily on
  // the first Spry pool's Initialize, so they may not exist when a non-Spry
  // pool's Swap is the first PoolManager event we see.
  if (!pool) {
    return
  }

  const bundle = Bundle.load('1')!
  const poolManager = PoolManager.load(poolManagerAddress)!

  const token0 = Token.load(pool.token0)
  const token1 = Token.load(pool.token1)

  if (token0 && token1) {
    // amounts - 0/1 are token deltas: can be positive or negative
    // Unlike V3, a negative amount represents that amount is being sent to the pool and vice versa, so invert the sign
    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals).times(BigDecimal.fromString('-1'))
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals).times(BigDecimal.fromString('-1'))

    /* ───────────────────────── Spry dynamic fee ──────────────────────────────
     * The per-swap LP fee comes from the paired SpryFee event (the authoritative
     * LP fee), via the SpryFeePending hand-off handleSpryFee wrote for this pool
     * immediately before this Swap log. It equals the V4 Swap event fee while the
     * protocol fee is 0 (Spry pools today). If no SpryFee was paired (shouldn't
     * happen on a Spry pool), fall back to the V4 Swap event fee.
     * We store the actual fee on `feeTier`, never the 0x800000 sentinel.
     * ───────────────────────────────────────────────────────────────────────── */
    const spryPending = SpryFeePending.load(poolId)
    const feePips = spryPending !== null ? spryPending.fee : BigInt.fromI32(cleanFeePips(event.params.fee))
    pool.feeTier = feePips

    // need absolute amounts for volume
    let amount0Abs = amount0
    if (amount0.lt(ZERO_BD)) {
      amount0Abs = amount0.times(BigDecimal.fromString('-1'))
    }
    let amount1Abs = amount1
    if (amount1.lt(ZERO_BD)) {
      amount1Abs = amount1.times(BigDecimal.fromString('-1'))
    }

    const amount0ETH = amount0Abs.times(token0.derivedETH)
    const amount1ETH = amount1Abs.times(token1.derivedETH)
    const amount0USD = amount0ETH.times(bundle.ethPriceUSD)
    const amount1USD = amount1ETH.times(bundle.ethPriceUSD)

    // get amount that should be tracked only - div 2 because cant count both input and output as volume
    const amountTotalUSDTracked = getTrackedAmountUSD(amount0Abs, token0, amount1Abs, token1, whitelistTokens).div(
      BigDecimal.fromString('2'),
    )
    const amountTotalETHTracked = safeDiv(amountTotalUSDTracked, bundle.ethPriceUSD)
    const amountTotalUSDUntracked = amount0USD.plus(amount1USD).div(BigDecimal.fromString('2'))

    const feesETH = amountTotalETHTracked.times(feePips.toBigDecimal()).div(BigDecimal.fromString('1000000'))
    const feesUSD = amountTotalUSDTracked.times(feePips.toBigDecimal()).div(BigDecimal.fromString('1000000'))

    // global updates
    poolManager.txCount = poolManager.txCount.plus(ONE_BI)
    poolManager.totalVolumeETH = poolManager.totalVolumeETH.plus(amountTotalETHTracked)
    poolManager.totalVolumeUSD = poolManager.totalVolumeUSD.plus(amountTotalUSDTracked)
    poolManager.untrackedVolumeUSD = poolManager.untrackedVolumeUSD.plus(amountTotalUSDUntracked)
    poolManager.totalFeesETH = poolManager.totalFeesETH.plus(feesETH)
    poolManager.totalFeesUSD = poolManager.totalFeesUSD.plus(feesUSD)

    // reset aggregate tvl before individual pool tvl updates
    const currentPoolTvlETH = pool.totalValueLockedETH
    poolManager.totalValueLockedETH = poolManager.totalValueLockedETH.minus(currentPoolTvlETH)

    // pool volume
    pool.volumeToken0 = pool.volumeToken0.plus(amount0Abs)
    pool.volumeToken1 = pool.volumeToken1.plus(amount1Abs)
    pool.volumeUSD = pool.volumeUSD.plus(amountTotalUSDTracked)
    pool.untrackedVolumeUSD = pool.untrackedVolumeUSD.plus(amountTotalUSDUntracked)
    pool.feesUSD = pool.feesUSD.plus(feesUSD)
    pool.txCount = pool.txCount.plus(ONE_BI)

    /* ──────────── Spry per-swap dynamic-fee running stats on the pool ─────────*/
    pool.lastFeePips = feePips
    pool.swapCount = pool.swapCount.plus(ONE_BI)
    pool.sumFeePips = pool.sumFeePips.plus(feePips)
    if (pool.minFeePips === null || feePips.lt(pool.minFeePips as BigInt)) {
      pool.minFeePips = feePips
    }
    if (pool.maxFeePips === null || feePips.gt(pool.maxFeePips as BigInt)) {
      pool.maxFeePips = feePips
    }
    // volume-weighted accumulator (weight = tracked USD volume of this swap)
    pool.feeWeightedVolumeUSD = pool.feeWeightedVolumeUSD.plus(feePips.toBigDecimal().times(amountTotalUSDTracked))
    pool.avgFeePips = safeDiv(pool.feeWeightedVolumeUSD, pool.volumeUSD)

    // Update the pool with the new active liquidity, price, and tick.
    pool.liquidity = event.params.liquidity
    pool.sqrtPrice = event.params.sqrtPriceX96
    pool.tick = BigInt.fromI32(event.params.tick)
    pool.totalValueLockedToken0 = pool.totalValueLockedToken0.plus(amount0)
    pool.totalValueLockedToken1 = pool.totalValueLockedToken1.plus(amount1)

    // update token0 data
    token0.volume = token0.volume.plus(amount0Abs)
    token0.totalValueLocked = token0.totalValueLocked.plus(amount0)
    token0.volumeUSD = token0.volumeUSD.plus(amountTotalUSDTracked)
    token0.untrackedVolumeUSD = token0.untrackedVolumeUSD.plus(amountTotalUSDUntracked)
    token0.feesUSD = token0.feesUSD.plus(feesUSD)
    token0.txCount = token0.txCount.plus(ONE_BI)

    // update token1 data
    token1.volume = token1.volume.plus(amount1Abs)
    token1.totalValueLocked = token1.totalValueLocked.plus(amount1)
    token1.volumeUSD = token1.volumeUSD.plus(amountTotalUSDTracked)
    token1.untrackedVolumeUSD = token1.untrackedVolumeUSD.plus(amountTotalUSDUntracked)
    token1.feesUSD = token1.feesUSD.plus(feesUSD)
    token1.txCount = token1.txCount.plus(ONE_BI)

    // updated pool rates
    const prices = sqrtPriceX96ToTokenPrices(pool.sqrtPrice, token0, token1, nativeTokenDetails)
    pool.token0Price = prices[0]
    pool.token1Price = prices[1]
    bundle.ethPriceUSD = getNativePriceInUSD(stablecoinWrappedNativePoolId, stablecoinIsToken0)
    bundle.save()

    token0.derivedETH = findNativePerToken(token0, wrappedNativeAddress, stablecoinAddresses, minimumNativeLocked)
    token1.derivedETH = findNativePerToken(token1, wrappedNativeAddress, stablecoinAddresses, minimumNativeLocked)

    /**
     * Things afffected by new USD rates
     */
    pool.totalValueLockedETH = pool.totalValueLockedToken0
      .times(token0.derivedETH)
      .plus(pool.totalValueLockedToken1.times(token1.derivedETH))
    pool.totalValueLockedUSD = pool.totalValueLockedETH.times(bundle.ethPriceUSD)

    poolManager.totalValueLockedETH = poolManager.totalValueLockedETH.plus(pool.totalValueLockedETH)
    poolManager.totalValueLockedUSD = poolManager.totalValueLockedETH.times(bundle.ethPriceUSD)

    token0.totalValueLockedUSD = token0.totalValueLocked.times(token0.derivedETH).times(bundle.ethPriceUSD)
    token1.totalValueLockedUSD = token1.totalValueLocked.times(token1.derivedETH).times(bundle.ethPriceUSD)

    // interval data
    const uniswapDayData = updateUniswapDayData(event, poolManagerAddress)
    const poolDayData = updatePoolDayData(event.params.id.toHexString(), event)
    const poolHourData = updatePoolHourData(event.params.id.toHexString(), event)
    const token0DayData = updateTokenDayData(token0, event)
    const token1DayData = updateTokenDayData(token1, event)
    const token0HourData = updateTokenHourData(token0, event)
    const token1HourData = updateTokenHourData(token1, event)

    // update volume metrics
    uniswapDayData.volumeETH = uniswapDayData.volumeETH.plus(amountTotalETHTracked)
    uniswapDayData.volumeUSD = uniswapDayData.volumeUSD.plus(amountTotalUSDTracked)
    uniswapDayData.feesUSD = uniswapDayData.feesUSD.plus(feesUSD)

    poolDayData.volumeUSD = poolDayData.volumeUSD.plus(amountTotalUSDTracked)
    poolDayData.volumeToken0 = poolDayData.volumeToken0.plus(amount0Abs)
    poolDayData.volumeToken1 = poolDayData.volumeToken1.plus(amount1Abs)
    poolDayData.feesUSD = poolDayData.feesUSD.plus(feesUSD)
    // Spry dynamic-fee stats for the day window
    poolDayData.lastFeePips = feePips
    poolDayData.swapCount = poolDayData.swapCount.plus(ONE_BI)
    poolDayData.sumFeePips = poolDayData.sumFeePips.plus(feePips)
    if (poolDayData.minFeePips === null || feePips.lt(poolDayData.minFeePips as BigInt)) {
      poolDayData.minFeePips = feePips
    }
    if (poolDayData.maxFeePips === null || feePips.gt(poolDayData.maxFeePips as BigInt)) {
      poolDayData.maxFeePips = feePips
    }
    poolDayData.feeWeightedVolumeUSD = poolDayData.feeWeightedVolumeUSD.plus(
      feePips.toBigDecimal().times(amountTotalUSDTracked),
    )
    poolDayData.avgFeePips = safeDiv(poolDayData.feeWeightedVolumeUSD, poolDayData.volumeUSD)

    poolHourData.volumeUSD = poolHourData.volumeUSD.plus(amountTotalUSDTracked)
    poolHourData.volumeToken0 = poolHourData.volumeToken0.plus(amount0Abs)
    poolHourData.volumeToken1 = poolHourData.volumeToken1.plus(amount1Abs)
    poolHourData.feesUSD = poolHourData.feesUSD.plus(feesUSD)
    // Spry dynamic-fee stats for the hour window
    poolHourData.lastFeePips = feePips
    poolHourData.swapCount = poolHourData.swapCount.plus(ONE_BI)
    poolHourData.sumFeePips = poolHourData.sumFeePips.plus(feePips)
    if (poolHourData.minFeePips === null || feePips.lt(poolHourData.minFeePips as BigInt)) {
      poolHourData.minFeePips = feePips
    }
    if (poolHourData.maxFeePips === null || feePips.gt(poolHourData.maxFeePips as BigInt)) {
      poolHourData.maxFeePips = feePips
    }
    poolHourData.feeWeightedVolumeUSD = poolHourData.feeWeightedVolumeUSD.plus(
      feePips.toBigDecimal().times(amountTotalUSDTracked),
    )
    poolHourData.avgFeePips = safeDiv(poolHourData.feeWeightedVolumeUSD, poolHourData.volumeUSD)

    token0DayData.volume = token0DayData.volume.plus(amount0Abs)
    token0DayData.volumeUSD = token0DayData.volumeUSD.plus(amountTotalUSDTracked)
    token0DayData.untrackedVolumeUSD = token0DayData.untrackedVolumeUSD.plus(amountTotalUSDTracked)
    token0DayData.feesUSD = token0DayData.feesUSD.plus(feesUSD)

    token0HourData.volume = token0HourData.volume.plus(amount0Abs)
    token0HourData.volumeUSD = token0HourData.volumeUSD.plus(amountTotalUSDTracked)
    token0HourData.untrackedVolumeUSD = token0HourData.untrackedVolumeUSD.plus(amountTotalUSDTracked)
    token0HourData.feesUSD = token0HourData.feesUSD.plus(feesUSD)

    token1DayData.volume = token1DayData.volume.plus(amount1Abs)
    token1DayData.volumeUSD = token1DayData.volumeUSD.plus(amountTotalUSDTracked)
    token1DayData.untrackedVolumeUSD = token1DayData.untrackedVolumeUSD.plus(amountTotalUSDTracked)
    token1DayData.feesUSD = token1DayData.feesUSD.plus(feesUSD)

    token1HourData.volume = token1HourData.volume.plus(amount1Abs)
    token1HourData.volumeUSD = token1HourData.volumeUSD.plus(amountTotalUSDTracked)
    token1HourData.untrackedVolumeUSD = token1HourData.untrackedVolumeUSD.plus(amountTotalUSDTracked)
    token1HourData.feesUSD = token1HourData.feesUSD.plus(feesUSD)

    /* ─────────────────────── Spry per-tier aggregate ─────────────────────────*/
    const tier = Tier.load(pool.tier)
    if (tier !== null) {
      tier.swapCount = tier.swapCount.plus(ONE_BI)
      tier.volumeUSD = tier.volumeUSD.plus(amountTotalUSDTracked)
      tier.feesUSD = tier.feesUSD.plus(feesUSD)
      tier.sumFeePips = tier.sumFeePips.plus(feePips)
      if (tier.minFeePips === null || feePips.lt(tier.minFeePips as BigInt)) {
        tier.minFeePips = feePips
      }
      if (tier.maxFeePips === null || feePips.gt(tier.maxFeePips as BigInt)) {
        tier.maxFeePips = feePips
      }
      tier.feeWeightedVolumeUSD = tier.feeWeightedVolumeUSD.plus(feePips.toBigDecimal().times(amountTotalUSDTracked))
      tier.avgFeePips = safeDiv(tier.feeWeightedVolumeUSD, tier.volumeUSD)
      tier.save()
    }

    token0DayData.save()
    token1DayData.save()
    uniswapDayData.save()
    poolDayData.save()
    poolHourData.save()
    token0HourData.save()
    token1HourData.save()

    const transaction = loadTransaction(event)
    const swap = new Swap(transaction.id + '-' + event.logIndex.toString())
    swap.transaction = transaction.id
    swap.timestamp = transaction.timestamp
    swap.pool = pool.id
    swap.token0 = pool.token0
    swap.token1 = pool.token1
    swap.sender = event.params.sender
    swap.origin = event.transaction.from
    swap.amount0 = amount0
    swap.amount1 = amount1
    swap.amountUSD = amountTotalUSDTracked
    swap.tick = BigInt.fromI32(event.params.tick)
    swap.sqrtPriceX96 = event.params.sqrtPriceX96
    swap.logIndex = event.logIndex
    // Spry per-swap dynamic-fee fields
    swap.fee = feePips
    swap.feePercent = feePipsToPercent(feePips)
    swap.feeAmountUSD = feesUSD
    swap.viaSpryRouter = event.params.sender.toHexString().toLowerCase() == spryRouterAddress.toLowerCase()
    // Attach the paired SpryFee observation (handleSpryFee ran immediately before
    // this Swap in the same tx for this pool) and consume the hand-off.
    if (spryPending !== null) {
      swap.spryFee = spryPending.observation
      swap.cumBefore = spryPending.cumBefore
      swap.cumAfter = spryPending.cumAfter
      swap.zone = spryPending.zone
      swap.dispatchCase = spryPending.dispatchCase
      swap.windowId = spryPending.windowId
      store.remove('SpryFeePending', poolId)
    }
    swap.save()

    poolManager.save()
    pool.save()
    token0.save()
    token1.save()
  }
}
