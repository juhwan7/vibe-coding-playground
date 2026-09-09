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

/**
 * 장중 15분+ 공백이 남아 있으면 Toss 캔들 API가 실제로 반환하는 nextBefore 커서를
 * 처음부터 끝까지 따라가며 최근 2거래일 1분봉을 다시 수집한다.
 * 임의 ISO 시각을 before 커서로 추정하지 않는다. 정상 동작 중인 금일이슈 차트와
 * 같은 페이지네이션 규칙을 사용해 오전 전체 누락도 복구한다.
 * 운영에서는 Pi의 theme-flow 진단으로 실제 시작 시각과 잔여 공백도 별도 확인한다.
 */
export async function repairMissingIntradayHistory({
  client,
  symbol,
  existing = [],
  maxItems = 1600,
  maxPages = 8,
} = {}) {
  const original = mergeCandles(existing, [], maxItems)
  let merged = original
  let gaps = findIntradayCandleGaps(merged)
  const beforeGapCount = gaps.length

  if (!gaps.length) {
    return {
      candles: merged,
      repaired: false,
      beforeGapCount: 0,
      afterGapCount: 0,
      pages: 0,
      requests: 0,
      exhausted: false,
      error: null,
      remainingGaps: [],
    }
  }

  const pageLimit = Math.max(1, Number(maxPages) || 8)
  // 복구 중에는 기존 캐시 크기보다 여유를 둬서 새 페이지가 과거 데이터를 밀어내지 않게 한다.
  const workingLimit = Math.max(maxItems, pageLimit * 200 + 400)
  let before = null
  let pages = 0
  let requests = 0
  let exhausted = false
  let error = null

  for (let page = 0; page < pageLimit && gaps.length; page += 1) {
    const query = new URLSearchParams({
      symbol: String(symbol ?? ''),
      interval: '1m',
      count: '200',
      adjusted: 'true',
    })
    if (before) query.set('before', before)

    let payload = null
    try {
      payload = await client.request(`/api/v1/candles?${query.toString()}`, {
        priority: 'background',
        dedupe: false,
      })
      requests += 1
    } catch (requestError) {
      error = requestError instanceof Error ? requestError.message : String(requestError)
      break
    }

    const incoming = candleRecords(payload)
    if (!incoming.length) {
      exhausted = true
      break
    }

    merged = mergeCandles(merged, incoming, workingLimit)
    gaps = findIntradayCandleGaps(merged)
    pages += 1
    if (!gaps.length) break

    const nextBefore = payload?.result?.nextBefore ?? null
    if (!nextBefore || nextBefore === before) {
      exhausted = true
      break
    }

    before = nextBefore
    await sleep(80)
  }

  const finalCandles = mergeCandles([], merged, maxItems)
  const finalGaps = findIntradayCandleGaps(finalCandles)

  return {
    candles: finalCandles,
    repaired: finalGaps.length < beforeGapCount,
    beforeGapCount,
    afterGapCount: finalGaps.length,
    pages,
    requests,
    exhausted,
    error,
    oldestTimestamp: finalCandles[0]?.timestamp ?? null,
    newestTimestamp: finalCandles.at(-1)?.timestamp ?? null,
    remainingGaps: finalGaps,
  }
}
