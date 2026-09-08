import test from 'node:test'
import assert from 'node:assert/strict'
import { marketSessionLabel } from './marketCollector.mjs'

test('classifies NXT pre-market in Korea time', () => {
  assert.match(marketSessionLabel(new Date('2026-09-08T23:10:00Z')), /NXT PRE/)
})

test('classifies integrated KRX and NXT regular session', () => {
  assert.match(marketSessionLabel(new Date('2026-09-08T02:00:00Z')), /KRX \+ NXT/)
})

test('classifies NXT after-market in Korea time', () => {
  assert.match(marketSessionLabel(new Date('2026-09-08T07:00:00Z')), /NXT AFTER/)
})
