import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as'

import { handleInitializeHelper } from '../../src/mappings/poolManager'
import { Initialize } from '../../src/types/PoolManager/PoolManager'
import { Pool } from '../../src/types/schema'
import { DYNAMIC_FEE_FLAG } from '../../src/utils/spry'
import {
  createAndStoreTestToken,
  MOCK_EVENT,
  TEST_CONFIG,
  TEST_SPRY_HOOK_ADDRESS,
  USDC_MAINNET_FIXTURE,
  USDC_WETH_POOL_ID,
  WETH_MAINNET_FIXTURE,
} from './constants'

// Builds an Initialize event with overridable hook / fee / tickSpacing so we can
// exercise the Spry filter and tier dispatch in isolation.
function buildInitialize(hooks: string, fee: i32, tickSpacing: i32): Initialize {
  const id = Bytes.fromHexString(USDC_WETH_POOL_ID) as Bytes
  return new Initialize(
    MOCK_EVENT.address,
    MOCK_EVENT.logIndex,
    MOCK_EVENT.transactionLogIndex,
    MOCK_EVENT.logType,
    MOCK_EVENT.block,
    MOCK_EVENT.transaction,
    [
      new ethereum.EventParam('id', ethereum.Value.fromFixedBytes(id)),
      new ethereum.EventParam('currency0', ethereum.Value.fromAddress(Address.fromString(USDC_MAINNET_FIXTURE.address))),
      new ethereum.EventParam('currency1', ethereum.Value.fromAddress(Address.fromString(WETH_MAINNET_FIXTURE.address))),
      new ethereum.EventParam('fee', ethereum.Value.fromI32(fee)),
      new ethereum.EventParam('tickSpacing', ethereum.Value.fromI32(tickSpacing)),
      new ethereum.EventParam('hooks', ethereum.Value.fromAddress(Address.fromString(hooks))),
      new ethereum.EventParam('sqrtPriceX96', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))),
      new ethereum.EventParam('tick', ethereum.Value.fromI32(1)),
    ],
    MOCK_EVENT.receipt,
  )
}

describe('handleInitialize - Spry filter & tier dispatch', () => {
  beforeEach(() => {
    clearStore()
    // pre-create tokens so the handler does not need RPC mocks
    createAndStoreTestToken(USDC_MAINNET_FIXTURE)
    createAndStoreTestToken(WETH_MAINNET_FIXTURE)
  })

  test('skips pools whose hook is not the SpryHook', () => {
    const notSpryHook = '0x0000000000000000000000000000000000001234'
    handleInitializeHelper(buildInitialize(notSpryHook, DYNAMIC_FEE_FLAG, 60), TEST_CONFIG, TEST_SPRY_HOOK_ADDRESS)
    assert.notInStore('Pool', USDC_WETH_POOL_ID)
    assert.entityCount('Pool', 0)
  })

  test('skips Spry-hook pools whose tickSpacing is not a Spry tier', () => {
    handleInitializeHelper(buildInitialize(TEST_SPRY_HOOK_ADDRESS, DYNAMIC_FEE_FLAG, 42), TEST_CONFIG, TEST_SPRY_HOOK_ADDRESS)
    assert.notInStore('Pool', USDC_WETH_POOL_ID)
    assert.entityCount('Pool', 0)
  })

  test('skips static-fee pools pointed at the hook (V4 ignores the override)', () => {
    // fee 500 is a static fee, not the 0x800000 dynamic sentinel — not a Spry pool
    handleInitializeHelper(buildInitialize(TEST_SPRY_HOOK_ADDRESS, 500, 60), TEST_CONFIG, TEST_SPRY_HOOK_ADDRESS)
    assert.notInStore('Pool', USDC_WETH_POOL_ID)
    assert.entityCount('Pool', 0)
  })

  test('indexes a Spry pool, flags it dynamic, and derives the BLUE_CHIP tier', () => {
    // tickSpacing 60 -> BLUE_CHIP (base 0.30% = 3000 pips, cap 5.50% = 55000 pips)
    handleInitializeHelper(buildInitialize(TEST_SPRY_HOOK_ADDRESS, DYNAMIC_FEE_FLAG, 60), TEST_CONFIG, TEST_SPRY_HOOK_ADDRESS)

    assert.entityCount('Pool', 1)
    const pool = Pool.load(USDC_WETH_POOL_ID)!
    assert.stringEquals(pool.tier, 'BLUE_CHIP')
    assert.assertTrue(pool.isDynamicFee)
    // feeTier must NOT be the raw 0x800000 sentinel — it starts at the tier base fee
    assert.bigIntEquals(pool.feeTier, BigInt.fromI32(3000))
    assert.bigIntEquals(pool.baseFeePips, BigInt.fromI32(3000))
    assert.bigIntEquals(pool.capFeePips, BigInt.fromI32(55000))

    // the per-tier aggregate is created and counts this pool
    assert.fieldEquals('Tier', 'BLUE_CHIP', 'poolCount', '1')
    assert.fieldEquals('Tier', 'BLUE_CHIP', 'tickSpacing', '60')
  })
})
