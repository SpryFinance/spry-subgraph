import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as'

import { handleSpryFee } from '../../src/mappings/spryFee'
import { handleSwapHelper } from '../../src/mappings/swap'
import { Swap } from '../../src/types/PoolManager/PoolManager'
import { SpryFee } from '../../src/types/SpryHook/SpryHook'
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

function makeSpryFee(
  logIndex: i32,
  cumBefore: i32,
  cumAfter: i32,
  fee: i32,
  zone: i32,
  dispatchCase: i32,
  windowId: i32,
): SpryFee {
  return new SpryFee(
    MOCK_EVENT.address,
    BigInt.fromI32(logIndex),
    MOCK_EVENT.transactionLogIndex,
    MOCK_EVENT.logType,
    MOCK_EVENT.block,
    MOCK_EVENT.transaction,
    [
      new ethereum.EventParam('id', ethereum.Value.fromFixedBytes(POOL_ID_BYTES)),
      new ethereum.EventParam('cumBefore', ethereum.Value.fromSignedBigInt(BigInt.fromI32(cumBefore))),
      new ethereum.EventParam('cumAfter', ethereum.Value.fromSignedBigInt(BigInt.fromI32(cumAfter))),
      new ethereum.EventParam('fee', ethereum.Value.fromI32(fee)),
      new ethereum.EventParam('zone', ethereum.Value.fromI32(zone)),
      new ethereum.EventParam('dispatchCase', ethereum.Value.fromI32(dispatchCase)),
      new ethereum.EventParam('windowId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(windowId))),
    ],
    MOCK_EVENT.receipt,
  )
}

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

describe('handleSpryFee (advanced)', () => {
  beforeEach(() => {
    clearStore()
    // dynamic Spry pool (USDC/WETH, tickSpacing 10 -> LIKE_ASSET)
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

  test('multi-hop on the same pool pairs each SpryFee to its own Swap', () => {
    const txHash = MOCK_EVENT.transaction.hash.toHexString()

    // hop 1: SpryFee log 0 (ALERT, GROWTH), then its Swap log 1
    handleSpryFee(makeSpryFee(0, 0, 1000, 600, 1, 0, 100))
    handleSwapHelper(makeSwap(1, 600), TEST_CONFIG)
    // hop 2: SpryFee log 2 (DANGER, GROWTH) in the same window, then Swap log 3
    handleSpryFee(makeSpryFee(2, 1000, 1500, 900, 2, 0, 100))
    handleSwapHelper(makeSwap(3, 900), TEST_CONFIG)

    // each Swap is joined to its OWN preceding observation
    assert.fieldEquals('Swap', txHash + '-1', 'spryFee', txHash + '-0')
    assert.fieldEquals('Swap', txHash + '-1', 'zone', 'ALERT')
    assert.fieldEquals('Swap', txHash + '-1', 'cumAfter', '1000')
    assert.fieldEquals('Swap', txHash + '-1', 'fee', '600')

    assert.fieldEquals('Swap', txHash + '-3', 'spryFee', txHash + '-2')
    assert.fieldEquals('Swap', txHash + '-3', 'zone', 'DANGER')
    assert.fieldEquals('Swap', txHash + '-3', 'cumBefore', '1000')
    assert.fieldEquals('Swap', txHash + '-3', 'cumAfter', '1500')
    assert.fieldEquals('Swap', txHash + '-3', 'fee', '900')

    // window 100 holds both observations
    const w = USDC_WETH_POOL_ID + '-100'
    assert.fieldEquals('SpryFeeWindow', w, 'cumOpen', '0')
    assert.fieldEquals('SpryFeeWindow', w, 'cumLast', '1500')
    assert.fieldEquals('SpryFeeWindow', w, 'cumMax', '1500')
    assert.fieldEquals('SpryFeeWindow', w, 'swapCount', '2')

    // pool + tier distributions accumulate
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'spryObservationCount', '2')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'alertCount', '1')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'dangerCount', '1')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'growthCount', '2')
    assert.fieldEquals('Tier', 'LIKE_ASSET', 'growthCount', '2')

    // both hand-offs consumed, exactly two observations
    assert.notInStore('SpryFeePending', USDC_WETH_POOL_ID)
    assert.entityCount('SpryFeeObservation', 2)
  })

  test('a new windowId starts a fresh SpryFeeWindow with a lazy-reset cumulative', () => {
    // window 100: DANGER / GROWTH, cum 0 -> 2000
    handleSpryFee(makeSpryFee(0, 0, 2000, 700, 2, 0, 100))
    // window 200: ALERT / UNWIND, cumBefore 0 (lazy reset), cumAfter -500
    handleSpryFee(makeSpryFee(1, 0, -500, 550, 1, 1, 200))

    assert.entityCount('SpryFeeWindow', 2)

    const w1 = USDC_WETH_POOL_ID + '-100'
    assert.fieldEquals('SpryFeeWindow', w1, 'cumMin', '0')
    assert.fieldEquals('SpryFeeWindow', w1, 'cumMax', '2000')
    assert.fieldEquals('SpryFeeWindow', w1, 'swapCount', '1')

    const w2 = USDC_WETH_POOL_ID + '-200'
    assert.fieldEquals('SpryFeeWindow', w2, 'cumOpen', '0')
    assert.fieldEquals('SpryFeeWindow', w2, 'cumLast', '-500')
    assert.fieldEquals('SpryFeeWindow', w2, 'cumMin', '-500')
    assert.fieldEquals('SpryFeeWindow', w2, 'cumMax', '0')
    assert.fieldEquals('SpryFeeWindow', w2, 'swapCount', '1')

    // pool reflects the latest hook state and the accumulated distributions
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'lastWindowId', '200')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'lastCum', '-500')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'lastZone', 'ALERT')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'lastDispatchCase', 'UNWIND')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'spryObservationCount', '2')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'dangerCount', '1')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'alertCount', '1')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'growthCount', '1')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'unwindCount', '1')
  })
})
