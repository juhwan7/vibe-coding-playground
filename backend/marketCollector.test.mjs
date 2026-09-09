import test from 'node:test'
import assert from 'node:assert/strict'
import {
  domesticCollectionActive,
  isDisplayableIndividualRanking,
  marketSessionLabel,
  mergeMarketTradingAmountRankings,
  nxtAfterMarketActive,
  rankingItem,
} from './marketCollector.mjs'

test('classifies NXT pre-market in Korea time', () => {
  assert.match(marketSessionLabel(new Date('2026-09-08T23:10:00Z')), /NXT PRE/)
})

test('classifies integrated KRX and NXT regular session', () => {
  assert.match(marketSessionLabel(new Date('2026-09-08T02:00:00Z')), /KRX \+ NXT/)
})

test('classifies NXT after-market from 15:30 through 20:00 in Korea time', () => {
  assert.match(marketSessionLabel(new Date('2026-09-09T06:30:00Z')), /NXT AFTER/)
  assert.match(marketSessionLabel(new Date('2026-09-09T11:00:00Z')), /NXT AFTER/)
})

test('domestic fast collection is active only from 08:00 through exactly 20:00 KST', () => {
  assert.equal(domesticCollectionActive(new Date('2026-09-08T22:59:59Z')), false)
  assert.equal(domesticCollectionActive(new Date('2026-09-08T23:00:00Z')), true)
  assert.equal(domesticCollectionActive(new Date('2026-09-09T11:00:00Z')), true)
  assert.equal(domesticCollectionActive(new Date('2026-09-09T11:00:01Z')), false)
})

test('NXT realtime ranking collection starts at 15:30 and stops after 20:00 KST', () => {
  assert.equal(nxtAfterMarketActive(new Date('2026-09-09T06:29:59Z')), false)
  assert.equal(nxtAfterMarketActive(new Date('2026-09-09T06:30:00Z')), true)
  assert.equal(nxtAfterMarketActive(new Date('2026-09-09T11:00:00Z')), true)
  assert.equal(nxtAfterMarketActive(new Date('2026-09-09T11:00:01Z')), false)
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

test('NXT 애프터마켓 realtime 누적 거래대금이 1d보다 크면 더 큰 실제 값을 채택한다', () => {
  const merged = mergeMarketTradingAmountRankings(
    [{ symbol: '000660', name: 'SK하이닉스', tradingAmount: 9_210_000_000_000, tradingVolume: 20_000_000, price: { lastPrice: 470000, changeRate: 0.03 } }],
    [{ symbol: '000660', name: 'SK하이닉스', tradingAmount: 10_300_000_000_000, tradingVolume: 22_000_000, price: { lastPrice: 475000, changeRate: 0.04 } }],
  )

  assert.equal(merged[0].tradingAmount, 10_300_000_000_000)
  assert.equal(merged[0].tradingVolume, 22_000_000)
  assert.equal(merged[0].lastPrice, 475000)
  assert.equal(merged[0].tradingAmountSource, 'market-ranking-realtime')
})

test('realtime 랭킹이 짧은 구간 값으로 더 작아도 기존 1d 누적 거래대금을 낮추지 않는다', () => {
  const merged = mergeMarketTradingAmountRankings(
    [{ symbol: '005930', name: '삼성전자', tradingAmount: 4_500_000_000_000, tradingVolume: 30_000_000 }],
    [{ symbol: '005930', name: '삼성전자', tradingAmount: 120_000_000_000, tradingVolume: 1_000_000 }],
  )

  assert.equal(merged[0].tradingAmount, 4_500_000_000_000)
  assert.equal(merged[0].tradingVolume, 30_000_000)
  assert.equal(merged[0].tradingAmountSource, 'market-ranking-1d')
})

test('TOP100 개별주 목록에서 이름 미확인 상품과 ETF/ETN을 제외한다', () => {
  assert.equal(isDisplayableIndividualRanking({ symbol: '005930', name: '삼성전자' }), true)
  assert.equal(isDisplayableIndividualRanking({ symbol: '069500', name: null }), false)
  assert.equal(isDisplayableIndividualRanking({ symbol: '069500', name: 'KODEX 200' }), false)
  assert.equal(isDisplayableIndividualRanking({ symbol: '122630', name: 'KODEX 레버리지' }), false)
  assert.equal(isDisplayableIndividualRanking({ symbol: '102110', name: 'TIGER 200' }), false)
  assert.equal(isDisplayableIndividualRanking({ symbol: '005930', name: '005930' }), false)
})