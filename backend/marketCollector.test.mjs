import test from 'node:test'
import assert from 'node:assert/strict'
import { marketSessionLabel, rankingItem } from './marketCollector.mjs'

test('classifies NXT pre-market in Korea time', () => {
  assert.match(marketSessionLabel(new Date('2026-09-08T23:10:00Z')), /NXT PRE/)
})

test('classifies integrated KRX and NXT regular session', () => {
  assert.match(marketSessionLabel(new Date('2026-09-08T02:00:00Z')), /KRX \+ NXT/)
})

test('classifies NXT after-market in Korea time', () => {
  assert.match(marketSessionLabel(new Date('2026-09-08T07:00:00Z')), /NXT AFTER/)
})

test('TOP100 랭킹의 displayName을 실제 종목명으로 사용한다', () => {
  const item = rankingItem({
    symbol: '005930',
    displayName: '삼성전자',
    tradingAmount: 123456,
  })
  assert.equal(item.name, '삼성전자')
})

test('TOP100 랭킹의 중첩 stock 이름 필드와 이전 정상 이름을 보존한다', () => {
  assert.equal(rankingItem({ stock: { symbol: '000660', koreanName: 'SK하이닉스' } }).name, 'SK하이닉스')
  assert.equal(rankingItem({ symbol: '000660', name: '000660' }, 'SK하이닉스').name, 'SK하이닉스')
})
