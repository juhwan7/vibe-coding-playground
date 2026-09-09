import { findIntradayCandleGaps } from './themeFlowService.mjs'
import { sleep } from './tossClient.mjs'

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function candleRecords(payload) {
  const candles = payload?.result?.candles
  if (!Array.isArray(candles)) return []
  return candles.map((candle) => {
    const close = number(candle.closePrice)
    if (!candle?.timestamp || close == null) return null
    const open = number(candle.openPrice) ?? close
    const high = number(candle.highPrice) ?? Math.max(open, close)
    const low = number(candle.lowPrice) ?? Math.min(open, close)
    const volume = Math.max(0, number(candle.volume) ?? 0)
    const prices = [open, high, low, close]
    const averagePrice = prices.reduce((sum, value) => sum + value, 0) / prices.length
    return {
      timestamp: candle.timestamp,
      openPrice: open,
      highPrice: high,
      lowPrice: low,
      closePrice: close,
      volume,
      tradingAmount: averagePrice * volume,
    }
  }).filter(Boolean)
}

function mergeCandles(existing = [], incoming = [], maxItems = 1600) {
  const map = new Map()
  for (const candle of [...existing, ...incoming]) {
    if (!candle?.timestamp || number(candle.closePrice) == null) continue
    map.set(candle.timestamp, candle)
  }
  return [...map.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-maxItems)
}

function gapSignature(gaps = []) {
  return gaps.map((gap) => `${gap.day}:${gap.edge}:${gap.from}:${gap.to}:${gap.gapMs}`).join('|')
}

function repairTarget(gaps = []) {
  if (!gaps.length) return null
  const latestDay = gaps.at(-1)?.day
  return gaps.find((gap) => gap.day === latestDay) ?? gaps.at(-1)
}

/**
 * 이미 수집된 최신 구간부터 무작정 페이지를 거슬러 올라가지 않고,
 * 실제로 비어 있는 구간의 오른쪽 끝(to)을 Toss `before` 커서로 직접 지정한다.
 * 예: 오늘 첫 캔들이 13:00이면 before=13:00으로 조회해 오전 1분봉을 즉시 복구한다.
 */
export async function repairMissingIntradayHistory({
  client,
  symbol,
  existing = [],
  maxItems = 1600,
  maxPages = 8,
} = {}) {
  let merged = mergeCandles(existing, [], maxItems)
  let gaps = findIntradayCandleGaps(merged)
  const beforeGapCount = gaps.length
  let pages = 0
  let requests = 0

  while (gaps.length && pages < maxPages) {
    const target = repairTarget(gaps)
    if (!target?.to) break

    const signatureBefore = gapSignature(gaps)
    const query = new URLSearchParams({
      symbol: String(symbol ?? ''),
      interval: '1m',
      count: '200',
      adjusted: 'true',
      before: target.to,
    })

    const payload = await client.request(`/api/v1/candles?${query.toString()}`)
    requests += 1
    const incoming = candleRecords(payload)
    if (!incoming.length) break

    merged = mergeCandles(merged, incoming, maxItems)
    gaps = findIntradayCandleGaps(merged)
    pages += 1

    if (!gaps.length) break
    if (gapSignature(gaps) === signatureBefore) break
    await sleep(80)
  }

  return {
    candles: merged,
    repaired: beforeGapCount > gaps.length,
    beforeGapCount,
    afterGapCount: gaps.length,
    pages,
    requests,
    remainingGaps: gaps,
  }
}
