import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as'

import { handleDonateHelper } from '../../src/mappings/donate'
import { handleModifyLiquidityHelper } from '../../src/mappings/modifyLiquidity'
import { handleSwapHelper } from '../../src/mappings/swap'
import { Donate, ModifyLiquidity, Swap } from '../../src/types/PoolManager/PoolManager'
import { MOCK_EVENT, TEST_CONFIG, USDC_WETH_POOL_ID } from './constants'

// The PoolManager data source receives Swap / ModifyLiquidity / Donate events for
// EVERY V4 pool (not just Spry), and the global Bundle / PoolManager entities are
// created lazily on the first Spry pool's Initialize. So a non-Spry pool's event
// can be processed before any Spry pool exists: the handlers must NOT touch the
// (absent) globals. Here the store is empty (no Bundle / PoolManager / Pool); the
// handlers must return cleanly instead of dereferencing null.

const ID = Bytes.fromHexString(USDC_WETH_POOL_ID) as Bytes
const SENDER = Address.fromString('0x841B5A0b3DBc473c8A057E2391014aa4C4751351')

function swapEvent(): Swap {
  return new Swap(
    MOCK_EVENT.address,
    MOCK_EVENT.logIndex,
    MOCK_EVENT.transactionLogIndex,
    MOCK_EVENT.logType,
    MOCK_EVENT.block,
    MOCK_EVENT.transaction,
    [
      new ethereum.EventParam('id', ethereum.Value.fromFixedBytes(ID)),
      new ethereum.EventParam('sender', ethereum.Value.fromAddress(SENDER)),
      new ethereum.EventParam('amount0', ethereum.Value.fromSignedBigInt(BigInt.fromString('-10007'))),
      new ethereum.EventParam('amount1', ethereum.Value.fromSignedBigInt(BigInt.fromString('10000'))),
      new ethereum.EventParam(
        'sqrtPriceX96',
        ethereum.Value.fromSignedBigInt(BigInt.fromString('79228162514264337514315787821')),
      ),
      new ethereum.EventParam('liquidity', ethereum.Value.fromSignedBigInt(BigInt.fromString('10000000000000000000000'))),
      new ethereum.EventParam('tick', ethereum.Value.fromI32(-1)),
      new ethereum.EventParam('fee', ethereum.Value.fromI32(3000)),
    ],
    MOCK_EVENT.receipt,
  )
}

function donateEvent(): Donate {
  return new Donate(
    MOCK_EVENT.address,
    MOCK_EVENT.logIndex,
    MOCK_EVENT.transactionLogIndex,
    MOCK_EVENT.logType,
    MOCK_EVENT.block,
    MOCK_EVENT.transaction,
    [
      new ethereum.EventParam('id', ethereum.Value.fromFixedBytes(ID)),
      new ethereum.EventParam('sender', ethereum.Value.fromAddress(SENDER)),
      new ethereum.EventParam('amount0', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000'))),
      new ethereum.EventParam('amount1', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('2000'))),
    ],
    MOCK_EVENT.receipt,
  )
}

function modifyLiquidityEvent(): ModifyLiquidity {
  return new ModifyLiquidity(
    MOCK_EVENT.address,
    MOCK_EVENT.logIndex,
    MOCK_EVENT.transactionLogIndex,
    MOCK_EVENT.logType,
    MOCK_EVENT.block,
    MOCK_EVENT.transaction,
    [
      new ethereum.EventParam('id', ethereum.Value.fromFixedBytes(ID)),
      new ethereum.EventParam('sender', ethereum.Value.fromAddress(SENDER)),
      new ethereum.EventParam('tickLower', ethereum.Value.fromI32(-600)),
      new ethereum.EventParam('tickUpper', ethereum.Value.fromI32(600)),
      new ethereum.EventParam('liquidityDelta', ethereum.Value.fromSignedBigInt(BigInt.fromString('1000000'))),
      new ethereum.EventParam(
        'salt',
        ethereum.Value.fromFixedBytes(
          Bytes.fromHexString('0x0000000000000000000000000000000000000000000000000000000000000000') as Bytes,
        ),
      ),
    ],
    MOCK_EVENT.receipt,
  )
}

describe('non-Spry pool events with no globals (regression: must not crash)', () => {
  beforeEach(() => {
    clearStore() // empty store: no Bundle, no PoolManager, no Pool
  })

  test('handleSwap on an unknown pool returns cleanly', () => {
    handleSwapHelper(swapEvent(), TEST_CONFIG)
    assert.entityCount('Swap', 0)
    assert.entityCount('Bundle', 0)
  })

  test('handleDonate on an unknown pool returns cleanly', () => {
    handleDonateHelper(donateEvent(), TEST_CONFIG)
    assert.entityCount('Donate', 0)
  })

  test('handleModifyLiquidity on an unknown pool returns cleanly', () => {
    handleModifyLiquidityHelper(modifyLiquidityEvent(), TEST_CONFIG)
    assert.entityCount('ModifyLiquidity', 0)
  })
})
