import { Donate as DonateEvent } from '../types/PoolManager/PoolManager'
import { Bundle, Donate, Pool, PoolManager, Token } from '../types/schema'
import { getSubgraphConfig, SubgraphConfig } from '../utils/chains'
import { ONE_BI } from '../utils/constants'
import { convertTokenToDecimal, loadTransaction } from '../utils/index'
import { calculateAmountUSD } from '../utils/pricing'

// The subgraph handler must have this signature to be able to handle events,
// however, we invoke a helper in order to inject dependencies for unit tests.
export function handleDonate(event: DonateEvent): void {
  handleDonateHelper(event)
}

// V4 PoolManager `Donate` adds tokens to a pool's in-range liquidity providers.
// The hook emits nothing extra here; we simply record the event for Spry pools.
// TVL is intentionally left untouched: donated amounts accrue to LPs as fees,
// and V4 does not surface them through the standard balance/price flow.
export function handleDonateHelper(event: DonateEvent, subgraphConfig: SubgraphConfig = getSubgraphConfig()): void {
  const poolManagerAddress = subgraphConfig.poolManagerAddress

  const poolId = event.params.id.toHexString()
  const pool = Pool.load(poolId)

  // Only Spry pools have a Pool entity (created by the Initialize filter). Skip
  // non-Spry pools BEFORE loading the global Bundle: it is created lazily on the
  // first Spry pool's Initialize and may not exist yet.
  if (pool === null) {
    return
  }

  const bundle = Bundle.load('1')!

  const token0 = Token.load(pool.token0)
  const token1 = Token.load(pool.token1)
  if (token0 === null || token1 === null) {
    return
  }

  const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
  const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)
  const amountUSD = calculateAmountUSD(amount0, amount1, token0.derivedETH, token1.derivedETH, bundle.ethPriceUSD)

  // count the donation as a transaction on the pool and the protocol
  pool.txCount = pool.txCount.plus(ONE_BI)
  pool.save()

  const poolManager = PoolManager.load(poolManagerAddress)
  if (poolManager !== null) {
    poolManager.txCount = poolManager.txCount.plus(ONE_BI)
    poolManager.save()
  }

  const transaction = loadTransaction(event)
  const donate = new Donate(transaction.id + '-' + event.logIndex.toString())
  donate.transaction = transaction.id
  donate.timestamp = transaction.timestamp
  donate.pool = pool.id
  donate.token0 = pool.token0
  donate.token1 = pool.token1
  donate.sender = event.params.sender
  donate.origin = event.transaction.from
  donate.amount0 = amount0
  donate.amount1 = amount1
  donate.amountUSD = amountUSD
  donate.logIndex = event.logIndex
  donate.save()
}
