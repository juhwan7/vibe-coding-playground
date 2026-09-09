function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function dateKey(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp))
}

function bucket3m(timestamp) {
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) return null
  return Math.floor(time / 180000) * 180000
}

function weightedAverage(entries = []) {
  const clean = entries.filter((entry) => Number.isFinite(entry?.value))
  if (!clean.length) return null
  const weighted = clean.filter((entry) => Number.isFinite(entry?.weight) && entry.weight > 0)
  const weightTotal = weighted.reduce((sum, entry) => sum + entry.weight, 0)
  if (weightTotal > 0) return weighted.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weightTotal
  return clean.reduce((sum, entry) => sum + entry.value, 0) / clean.length
}

/**
 * 테마 구성종목의 수익률을 3분 거래대금으로 가중해 하나의 선으로 만든다.
 * 같은 시각에 거래대금이 압도적으로 큰 종목일수록 테마선에 더 큰 영향을 준다.
 * 거래대금이 전부 0/누락이면 해당 버킷에 한해 단순평균으로 안전하게 폴백한다.
 */
export function aggregateTradingAmountWeightedThemeSeries(memberSeries = []) {
  const buckets = new Map()

  for (const { symbol, candles } of memberSeries) {
    const ordered = [...(candles ?? [])]
      .filter((candle) => candle?.timestamp && number(candle.closePrice) != null)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    if (!ordered.length) continue

    const baseline = number(ordered[0].closePrice)
    if (!baseline) continue
    const perBucket = new Map()

    for (const candle of ordered) {
      const key = bucket3m(candle.timestamp)
      const closePrice = number(candle.closePrice)
      if (key == null || closePrice == null) continue
      const openPrice = number(candle.openPrice) ?? closePrice
      const highPrice = number(candle.highPrice) ?? Math.max(openPrice, closePrice)
      const lowPrice = number(candle.lowPrice) ?? Math.min(openPrice, closePrice)
      const volume = Math.max(0, number(candle.volume) ?? 0)
      const tradingAmount = Math.max(0, number(candle.tradingAmount) ?? closePrice * volume)
      const current = perBucket.get(key) ?? {
        timestamp: new Date(key).toISOString(),
        openValue: null,
        highValue: -Infinity,
        lowValue: Infinity,
        closeValue: null,
        volume: 0,
        tradingAmount: 0,
      }
      const openValue = (openPrice / baseline - 1) * 100
      const highValue = (highPrice / baseline - 1) * 100
      const lowValue = (lowPrice / baseline - 1) * 100
      const closeValue = (closePrice / baseline - 1) * 100
      if (current.openValue == null) current.openValue = openValue
      current.highValue = Math.max(current.highValue, highValue)
      current.lowValue = Math.min(current.lowValue, lowValue)
      current.closeValue = closeValue
      current.volume += volume
      current.tradingAmount += tradingAmount
      perBucket.set(key, current)
    }

    for (const [key, point] of perBucket) {
      const aggregate = buckets.get(key) ?? {
        timestamp: point.timestamp,
        opens: [], highs: [], lows: [], closes: [],
        volume: 0,
        tradingAmount: 0,
        symbols: new Set(),
        maxMemberTradingAmount: 0,
      }
      const weight = point.tradingAmount
      if (point.openValue != null) aggregate.opens.push({ value: point.openValue, weight })
      if (Number.isFinite(point.highValue)) aggregate.highs.push({ value: point.highValue, weight })
      if (Number.isFinite(point.lowValue)) aggregate.lows.push({ value: point.lowValue, weight })
      if (point.closeValue != null) aggregate.closes.push({ value: point.closeValue, weight })
      aggregate.volume += point.volume
      aggregate.tradingAmount += point.tradingAmount
      aggregate.maxMemberTradingAmount = Math.max(aggregate.maxMemberTradingAmount, point.tradingAmount)
      aggregate.symbols.add(symbol)
      buckets.set(key, aggregate)
    }
  }

  return [...buckets.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map((bucket) => {
      const openValue = weightedAverage(bucket.opens)
      const highValue = weightedAverage(bucket.highs)
      const lowValue = weightedAverage(bucket.lows)
      const closeValue = weightedAverage(bucket.closes)
      return {
        timestamp: bucket.timestamp,
        value: closeValue,
        openValue,
        highValue,
        lowValue,
        closeValue,
        volume: bucket.volume,
        tradingAmount: bucket.tradingAmount,
        memberCount: bucket.symbols.size,
        dominantWeightPercent: bucket.tradingAmount > 0 ? bucket.maxMemberTradingAmount / bucket.tradingAmount * 100 : null,
        day: dateKey(bucket.timestamp),
      }
    })
    .filter((point) => point.value != null)
}
