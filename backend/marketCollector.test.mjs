import test from 'node:test'
import assert from 'node:assert/strict'
import { isDisplayableIndividualRanking, marketSessionLabel, rankingItem } from './marketCollector.mjs'

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

test('TOP100 랭킹의 shortName과 koreanName도 실제 종목명으로 사용한다', () => {
  assert.equal(rankingItem({ symbol: '005380', shortName: '현대차' }).name, '현대차')
  assert.equal(rankingItem({ symbol: '000270', koreanName: '기아' }).name, '기아')
})

test('TOP100 랭킹의 중첩 stock 이름 필드와 이전 정상 이름을 보존한다', () => {
  assert.equal(rankingItem({ stock: { symbol: '000660', koreanName: 'SK하이닉스' } }).name, 'SK하이닉스')
  assert.equal(rankingItem({ symbol: '000660', name: '000660' }, 'SK하이닉스').name, 'SK하이닉스')
})

test('TOP100 개별주 목록에서 이름 미확인 상품과 ETF/ETN을 제외한다', () => {
  assert.equal(isDisplayableIndividualRanking({ symbol: '005930', name: '삼성전자' }), true)
  assert.equal(isDisplayableIndividualRanking({ symbol: '069500', name: null }), false)
  assert.equal(isDisplayableIndividualRanking({ symbol: '069500', name: 'KODEX 200' }), false)
  assert.equal(isDisplayableIndividualRanking({ symbol: '122630', name: 'KODEX 레버리지' }), false)
  assert.equal(isDisplayableIndividualRanking({ symbol: '102110', name: 'TIGER 200' }), false)
  assert.equal(isDisplayableIndividualRanking({ symbol: '005930', name: '005930' }), false)
})
