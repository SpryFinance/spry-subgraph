import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { assert, beforeAll, describe, test } from 'matchstick-as'

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

// SpryFee at logIndex 0: window 12345, cumBefore 0 -> cumAfter 1000, fee 800 pips,
// zone 1 (ALERT), dispatchCase 0 (GROWTH).
const SPRY_FEE_EVENT = new SpryFee(
  MOCK_EVENT.address,
  BigInt.fromI32(0),
  MOCK_EVENT.transactionLogIndex,
  MOCK_EVENT.logType,
  MOCK_EVENT.block,
  MOCK_EVENT.transaction,
  [
    new ethereum.EventParam('id', ethereum.Value.fromFixedBytes(POOL_ID_BYTES)),
    new ethereum.EventParam('cumBefore', ethereum.Value.fromSignedBigInt(BigInt.fromI32(0))),
    new ethereum.EventParam('cumAfter', ethereum.Value.fromSignedBigInt(BigInt.fromI32(1000))),
    new ethereum.EventParam('fee', ethereum.Value.fromI32(800)),
    new ethereum.EventParam('zone', ethereum.Value.fromI32(1)),
    new ethereum.EventParam('dispatchCase', ethereum.Value.fromI32(0)),
    new ethereum.EventParam('windowId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(12345))),
  ],
  MOCK_EVENT.receipt,
)

// The paired V4 Swap at logIndex 1 (same tx, same pool).
const SWAP_EVENT = new Swap(
  MOCK_EVENT.address,
  BigInt.fromI32(1),
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
    new ethereum.EventParam('fee', ethereum.Value.fromI32(800)),
  ],
  MOCK_EVENT.receipt,
)

describe('handleSpryFee + Swap pairing', () => {
  beforeAll(() => {
    // create a dynamic Spry pool (USDC/WETH, tickSpacing 10 -> LIKE_ASSET)
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

  test('records the observation, window, distributions, and joins onto the Swap', () => {
    const txHash = MOCK_EVENT.transaction.hash.toHexString()
    const obsId = txHash + '-0'
    const swapId = txHash + '-1'
    const windowEntId = USDC_WETH_POOL_ID + '-12345'

    // ── SpryFee handler runs first (lower logIndex) ──
    handleSpryFee(SPRY_FEE_EVENT)

    assert.fieldEquals('SpryFeeObservation', obsId, 'pool', USDC_WETH_POOL_ID)
    assert.fieldEquals('SpryFeeObservation', obsId, 'tier', 'LIKE_ASSET')
    assert.fieldEquals('SpryFeeObservation', obsId, 'fee', '800')
    assert.fieldEquals('SpryFeeObservation', obsId, 'cumBefore', '0')
    assert.fieldEquals('SpryFeeObservation', obsId, 'cumAfter', '1000')
    assert.fieldEquals('SpryFeeObservation', obsId, 'zone', 'ALERT')
    assert.fieldEquals('SpryFeeObservation', obsId, 'dispatchCase', 'GROWTH')
    assert.fieldEquals('SpryFeeObservation', obsId, 'windowId', '12345')

    assert.fieldEquals('SpryFeeWindow', windowEntId, 'cumOpen', '0')
    assert.fieldEquals('SpryFeeWindow', windowEntId, 'cumLast', '1000')
    assert.fieldEquals('SpryFeeWindow', windowEntId, 'cumMax', '1000')
    assert.fieldEquals('SpryFeeWindow', windowEntId, 'swapCount', '1')

    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'spryObservationCount', '1')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'alertCount', '1')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'growthCount', '1')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'lastZone', 'ALERT')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'lastWindowId', '12345')
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'lastCum', '1000')

    assert.fieldEquals('Tier', 'LIKE_ASSET', 'alertCount', '1')
    assert.fieldEquals('Tier', 'LIKE_ASSET', 'growthCount', '1')

    // hand-off written, awaiting the Swap
    assert.fieldEquals('SpryFeePending', USDC_WETH_POOL_ID, 'observation', obsId)

    // ── Swap handler runs next and consumes the hand-off ──
    handleSwapHelper(SWAP_EVENT, TEST_CONFIG)

    assert.fieldEquals('Swap', swapId, 'spryFee', obsId)
    assert.fieldEquals('Swap', swapId, 'zone', 'ALERT')
    assert.fieldEquals('Swap', swapId, 'dispatchCase', 'GROWTH')
    assert.fieldEquals('Swap', swapId, 'cumBefore', '0')
    assert.fieldEquals('Swap', swapId, 'cumAfter', '1000')
    assert.fieldEquals('Swap', swapId, 'windowId', '12345')
    // fee is sourced from the paired SpryFee (the authoritative LP fee)
    assert.fieldEquals('Swap', swapId, 'fee', '800')

    // hand-off consumed
    assert.notInStore('SpryFeePending', USDC_WETH_POOL_ID)
  })
})
