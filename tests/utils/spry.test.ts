import { BigInt } from '@graphprotocol/graph-ts'
import { assert, describe, test } from 'matchstick-as'

import {
  cleanFeePips,
  dispatchCaseName,
  DYNAMIC_FEE_FLAG,
  feePipsToPercent,
  isDynamicFee,
  OVERRIDE_FEE_FLAG,
  tierFromTickSpacing,
  zoneName,
} from '../../src/utils/spry'

describe('spry helpers', () => {
  test('tierFromTickSpacing maps every Spry tier', () => {
    const stable = tierFromTickSpacing(1)!
    assert.stringEquals(stable.name, 'STABLE')
    assert.bigIntEquals(stable.baseFeePips, BigInt.fromI32(100))
    assert.bigIntEquals(stable.capFeePips, BigInt.fromI32(5000))

    const like = tierFromTickSpacing(10)!
    assert.stringEquals(like.name, 'LIKE_ASSET')
    assert.bigIntEquals(like.baseFeePips, BigInt.fromI32(500))
    assert.bigIntEquals(like.capFeePips, BigInt.fromI32(10000))

    const blue = tierFromTickSpacing(60)!
    assert.stringEquals(blue.name, 'BLUE_CHIP')
    assert.bigIntEquals(blue.baseFeePips, BigInt.fromI32(3000))
    assert.bigIntEquals(blue.capFeePips, BigInt.fromI32(55000))

    const vol = tierFromTickSpacing(200)!
    assert.stringEquals(vol.name, 'VOLATILE')
    assert.bigIntEquals(vol.baseFeePips, BigInt.fromI32(5000))
    assert.bigIntEquals(vol.capFeePips, BigInt.fromI32(90000))

    const exotic = tierFromTickSpacing(1000)!
    assert.stringEquals(exotic.name, 'EXOTIC')
    assert.bigIntEquals(exotic.baseFeePips, BigInt.fromI32(10000))
    assert.bigIntEquals(exotic.capFeePips, BigInt.fromI32(99000))
  })

  test('tierFromTickSpacing rejects non-Spry tickSpacings', () => {
    assert.assertTrue(tierFromTickSpacing(0) === null)
    assert.assertTrue(tierFromTickSpacing(2) === null)
    assert.assertTrue(tierFromTickSpacing(42) === null)
    assert.assertTrue(tierFromTickSpacing(100) === null)
  })

  test('feePipsToPercent divides pips by 10000', () => {
    assert.stringEquals(feePipsToPercent(BigInt.fromI32(3000)).toString(), '0.3')
    assert.stringEquals(feePipsToPercent(BigInt.fromI32(500)).toString(), '0.05')
    assert.stringEquals(feePipsToPercent(BigInt.fromI32(100)).toString(), '0.01')
    assert.stringEquals(feePipsToPercent(BigInt.fromI32(0)).toString(), '0')
  })

  test('isDynamicFee only matches the 0x800000 sentinel', () => {
    assert.assertTrue(isDynamicFee(DYNAMIC_FEE_FLAG))
    assert.assertTrue(isDynamicFee(0x800000))
    assert.assertTrue(!isDynamicFee(500))
    assert.assertTrue(!isDynamicFee(0))
    assert.assertTrue(!isDynamicFee(OVERRIDE_FEE_FLAG))
  })

  test('cleanFeePips strips the override / dynamic flags', () => {
    // a plain fee passes through untouched
    assert.assertTrue(cleanFeePips(3000) == 3000)
    assert.assertTrue(cleanFeePips(0) == 0)
    // the OVERRIDE flag (0x400000) is removed, leaving the low 22 bits
    assert.assertTrue(cleanFeePips(OVERRIDE_FEE_FLAG | 3000) == 3000)
    assert.assertTrue(cleanFeePips(DYNAMIC_FEE_FLAG | 9900) == 9900)
  })

  test('zoneName maps the 4 zones', () => {
    assert.stringEquals(zoneName(0), 'SAFE')
    assert.stringEquals(zoneName(1), 'ALERT')
    assert.stringEquals(zoneName(2), 'DANGER')
    assert.stringEquals(zoneName(3), 'CAP')
  })

  test('dispatchCaseName maps the 3 cases', () => {
    assert.stringEquals(dispatchCaseName(0), 'GROWTH')
    assert.stringEquals(dispatchCaseName(1), 'UNWIND')
    assert.stringEquals(dispatchCaseName(2), 'FLIP')
  })
})
