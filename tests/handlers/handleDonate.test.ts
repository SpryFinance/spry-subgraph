import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as'

import { handleDonateHelper } from '../../src/mappings/donate'
import { Donate } from '../../src/types/PoolManager/PoolManager'
import { Bundle, Token } from '../../src/types/schema'
import { convertTokenToDecimal } from '../../src/utils/index'
import {
  invokePoolCreatedWithMockedEthCalls,
  MOCK_EVENT,
  TEST_CONFIG,
  TEST_ETH_PRICE_USD,
  TEST_USDC_DERIVED_ETH,
  TEST_WETH_DERIVED_ETH,
  USDC_MAINNET_FIXTURE,
  USDC_WETH_POOL_ID,
  WBTC_WETH_POOL_ID,
  WETH_MAINNET_FIXTURE,
} from './constants'

function makeDonate(poolIdHex: string, amount0: string, amount1: string): Donate {
  return new Donate(
    MOCK_EVENT.address,
    MOCK_EVENT.logIndex,
    MOCK_EVENT.transactionLogIndex,
    MOCK_EVENT.logType,
    MOCK_EVENT.block,
    MOCK_EVENT.transaction,
    [
      new ethereum.EventParam('id', ethereum.Value.fromFixedBytes(Bytes.fromHexString(poolIdHex) as Bytes)),
      new ethereum.EventParam(
        'sender',
        ethereum.Value.fromAddress(Address.fromString('0x39BF2eFF94201cfAA471932655404F63315147a4')),
      ),
      new ethereum.EventParam('amount0', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount0))),
      new ethereum.EventParam('amount1', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount1))),
    ],
    MOCK_EVENT.receipt,
  )
}

describe('handleDonate', () => {
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

  test('records a donation on a Spry pool and bumps tx counts', () => {
    handleDonateHelper(makeDonate(USDC_WETH_POOL_ID, '5000000', '3000000'), TEST_CONFIG)

    const id = MOCK_EVENT.transaction.hash.toHexString() + '-' + MOCK_EVENT.logIndex.toString()
    const amount0 = convertTokenToDecimal(BigInt.fromString('5000000'), BigInt.fromString(USDC_MAINNET_FIXTURE.decimals))
    const amount1 = convertTokenToDecimal(BigInt.fromString('3000000'), BigInt.fromString(WETH_MAINNET_FIXTURE.decimals))

    assert.fieldEquals('Donate', id, 'pool', USDC_WETH_POOL_ID)
    assert.fieldEquals('Donate', id, 'token0', USDC_MAINNET_FIXTURE.address)
    assert.fieldEquals('Donate', id, 'token1', WETH_MAINNET_FIXTURE.address)
    assert.fieldEquals('Donate', id, 'sender', '0x39bf2eff94201cfaa471932655404f63315147a4')
    assert.fieldEquals('Donate', id, 'amount0', amount0.toString())
    assert.fieldEquals('Donate', id, 'amount1', amount1.toString())

    // a donation counts as a transaction on the pool and the protocol
    assert.fieldEquals('Pool', USDC_WETH_POOL_ID, 'txCount', '1')
    assert.fieldEquals('PoolManager', TEST_CONFIG.poolManagerAddress, 'txCount', '1')
  })

  test('skips a Donate on a pool that is not a Spry pool (no Pool entity)', () => {
    // WBTC/WETH was never initialized in this test, so it has no Pool entity
    handleDonateHelper(makeDonate(WBTC_WETH_POOL_ID, '1000', '2000'), TEST_CONFIG)
    assert.entityCount('Donate', 0)
  })
})
