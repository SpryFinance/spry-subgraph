import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as'

import { handleSwapHelper } from '../../src/mappings/swap'
import { Swap } from '../../src/types/PoolManager/PoolManager'
import { Bundle, Token } from '../../src/types/schema'
import {
  invokePoolCreatedWithMockedEthCalls,
  MOCK_EVENT,
  TEST_CONFIG,
  TEST_ETH_PRICE_USD,
  TEST_USDC_DERIVED_ETH,
  TEST_WETH_DERIVED_ETH,
  USDC_MAINNET_FIXTURE,
  USDC_WETH_POOL_ID,
  WETH_MAINNET_FIXTURE,
} from './constants'

const POOL_ID_BYTES = Bytes.fromHexString(USDC_WETH_POOL_ID) as Bytes

// A Swap with a given fee (no SpryFee paired, so the handler uses event.params.fee).
function makeSwap(logIndex: i32, fee: i32): Swap {
  return new Swap(
    MOCK_EVENT.address,
    BigInt.fromI32(logIndex),
    MOCK_EVENT.transactionLogIndex,
    MOCK_EVENT.logType,
    MOCK_EVENT.block,
    MOCK_EVENT.transaction,
    [
      new ethereum.EventParam('id', ethereum.Value.fromFixedBytes(POOL_ID_BYTES)),
      new ethereum.EventParam(
        'sender',
        ethereum.Value.fromAddress(Address.fromString('0x841B5A0b3DBc473c8A057E2391014aa4C4751351')),
      ),
      new ethereum.EventParam('amount0', ethereum.Value.fromSignedBigInt(BigInt.fromString('-10007'))),
      new ethereum.EventParam('amount1', ethereum.Value.fromSignedBigInt(BigInt.fromString('10000'))),
      new ethereum.EventParam(
        'sqrtPriceX96',
        ethereum.Value.fromSignedBigInt(BigInt.fromString('79228162514264337514315787821')),
      ),
      new ethereum.EventParam('liquidity', ethereum.Value.fromSignedBigInt(BigInt.fromString('10000000000000000000000'))),
      new ethereum.EventParam('tick', ethereum.Value.fromI32(-1)),
      new ethereum.EventParam('fee', ethereum.Value.fromI32(fee)),
    ],
    MOCK_EVENT.receipt,
  )
}

describe('handleSwap dynamic-fee aggregation', () => {
  beforeEach(() => {
    clearStore()
    invokePoolCreatedWithMockedEthCalls(MOCK_EVENT, TEST_CONFIG)
    const bundle = new Bundle('1')
    bundle.ethPriceUSD = TEST_ETH_PRICE_USD
    bundle.save()
    const usdc = Token.load(USDC_MAINNET_FIXTURE.address)!
    usdc.derivedETH = TEST_USDC_DERIVED_ETH
    usdc.save()
    const weth = Token.load(WETH_MAINNET_FIXTURE.address)!
    weth.derivedETH = TEST_WETH_DERIVED_ETH
    weth.save()
  })

  test('two swaps with different fees accumulate min/max/sum/last on pool, day, hour', () => {
    handleSwapHelper(makeSwap(1, 600), TEST_CONFIG)
    handleSwapHelper(makeSwap(2, 1000), TEST_CONFIG)

    // pool running stats
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'swapCount', '2')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'sumFeePips', '1600')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'minFeePips', '600')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'maxFeePips', '1000')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'lastFeePips', '1000')
    // feeTier tracks the current (last) fee, never the 0x800000 sentinel
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'feeTier', '1000')

    // same window for both swaps -> the day/hour buckets accumulate identically
    const dayId = (MOCK_EVENT.block.timestamp.toI32() / 86400).toString()
    const hourId = (MOCK_EVENT.block.timestamp.toI32() / 3600).toString()

    assert.fieldEquals('PoolDayData', USDC_WETH_POOL_ID + '-' + dayId, 'swapCount', '2')
    assert.fieldEquals('PoolDayData', USDC_WETH_POOL_ID + '-' + dayId, 'sumFeePips', '1600')
    assert.fieldEquals('PoolDayData', USDC_WETH_POOL_ID + '-' + dayId, 'minFeePips', '600')
    assert.fieldEquals('PoolDayData', USDC_WETH_POOL_ID + '-' + dayId, 'maxFeePips', '1000')
    assert.fieldEquals('PoolDayData', USDC_WETH_POOL_ID + '-' + dayId, 'lastFeePips', '1000')

    assert.fieldEquals('PoolHourData', USDC_WETH_POOL_ID + '-' + hourId, 'swapCount', '2')
    assert.fieldEquals('PoolHourData', USDC_WETH_POOL_ID + '-' + hourId, 'sumFeePips', '1600')
    assert.fieldEquals('PoolHourData', USDC_WETH_POOL_ID + '-' + hourId, 'minFeePips', '600')
    assert.fieldEquals('PoolHourData', USDC_WETH_POOL_ID + '-' + hourId, 'maxFeePips', '1000')

    // tier accumulates both swaps too
    assert.fieldEquals('Tier', 'LIKE_ASSET', 'swapCount', '2')
    assert.fieldEquals('Tier', 'LIKE_ASSET', 'sumFeePips', '1600')
    assert.fieldEquals('Tier', 'LIKE_ASSET', 'minFeePips', '600')
    assert.fieldEquals('Tier', 'LIKE_ASSET', 'maxFeePips', '1000')
  })
})
