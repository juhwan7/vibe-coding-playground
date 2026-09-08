import { mkdir, readFile, writeFile, appendFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

function minuteKey(iso) {
  return String(iso || '').slice(0, 16)
}

function kstParts(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso))
  const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

function compactStock(stock) {
  return {
    symbol: stock.symbol,
    name: stock.name ?? null,
    market: stock.market ?? null,
    lastPrice: stock.lastPrice ?? null,
    changeRate: stock.changeRate ?? null,
    tradingAmount: stock.tradingAmount ?? null,
    tradingVolume: stock.tradingVolume ?? null,
    foreignNetBuyVolume: stock.foreignNetBuyVolume ?? null,
    institutionNetBuyVolume: stock.institutionNetBuyVolume ?? null,
  }
}

function compactRanking(item) {
  return {
    symbol: item.symbol ?? null,
    name: item.name ?? null,
    market: item.market ?? null,
    lastPrice: item.lastPrice ?? null,
    changeRate: item.changeRate ?? null,
    tradingAmount: item.tradingAmount ?? null,
    tradingVolume: item.tradingVolume ?? null,
  }
}

function compactSnapshot(snapshot) {
  return {
    updatedAt: snapshot.updatedAt,
    marketSession: snapshot.marketSession,
    marketTradingAmount: snapshot.marketTradingAmount ?? null,
    marketTradingAmountCoverage: snapshot.marketTradingAmountCoverage ?? null,
    indices: snapshot.indices ?? {},
    marketInvestors: snapshot.marketInvestors ?? null,
    programSummary: snapshot.programSummary ?? null,
    futures: snapshot.futures ?? null,
    topRankings: (snapshot.topRankings ?? []).slice(0, 100).map(compactRanking),
    stocks: Object.fromEntries(Object.entries(snapshot.stocks ?? {}).map(([symbol, stock]) => [symbol, compactStock(stock)])),
  }
}

export class SnapshotStore {
  constructor({ filePath = process.env.MARKET_HISTORY_PATH || '/app/data/market-history.jsonl', retainDays = 35 } = {}) {
    this.filePath = filePath
    this.retainDays = retainDays
    this.lastMinute = null
    this.lastPruneDay = null
    this.ready = mkdir(dirname(filePath), { recursive: true }).catch(() => {})
  }

  async maybeAppend(snapshot) {
    if (!snapshot?.ok || !snapshot.updatedAt) return false
    const { hour, minute } = kstParts(snapshot.updatedAt)
    const marketMinute = hour * 60 + minute
    if (marketMinute < 480 || marketMinute > 1200) return false

    const key = minuteKey(snapshot.updatedAt)
    if (!key || key === this.lastMinute) return false
    this.lastMinute = key
    await this.ready
    await appendFile(this.filePath, `${JSON.stringify(compactSnapshot(snapshot))}\n`, 'utf8')

    const day = kstParts(snapshot.updatedAt).day
    if (day && day !== this.lastPruneDay) {
      this.lastPruneDay = day
      await this.prune().catch(() => {})
    }
    return true
  }

  async read({ days = 5, resolutionMinutes = 5 } = {}) {
    await this.ready
    const safeDays = Math.max(1, Math.min(35, Number(days) || 5))
    const safeResolution = Math.max(1, Math.min(30, Number(resolutionMinutes) || 5))
    let text = ''
    try { text = await readFile(this.filePath, 'utf8') } catch { return { days: safeDays, resolutionMinutes: safeResolution, tradingDays: 0, samples: [] } }
    const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000
    const buckets = new Map()
    const tradingDays = new Set()
    for (const line of text.split('\n')) {
      if (!line) continue
      try {
        const item = JSON.parse(line)
        const time = Date.parse(item.updatedAt)
        if (!Number.isFinite(time) || time < cutoff) continue
        const { day, hour, minute } = kstParts(item.updatedAt)
        const marketMinute = hour * 60 + minute
        if (marketMinute < 480 || marketMinute > 1200) continue
        const relativeMinute = marketMinute - 480
        const bucket = Math.floor(relativeMinute / safeResolution)
        buckets.set(`${day}:${bucket}`, item)
        tradingDays.add(day)
      } catch {
        // 손상된 한 줄은 건너뛰고 나머지 히스토리는 유지한다.
      }
    }
    const samples = [...buckets.values()].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    return { days: safeDays, resolutionMinutes: safeResolution, tradingDays: tradingDays.size, samples }
  }

  async prune() {
    await this.ready
    try {
      const info = await stat(this.filePath)
      if (info.size < 250 * 1024 * 1024) return
    } catch { return }

    const cutoff = Date.now() - this.retainDays * 24 * 60 * 60 * 1000
    const text = await readFile(this.filePath, 'utf8')
    const kept = []
    for (const line of text.split('\n')) {
      if (!line) continue
      try {
        const item = JSON.parse(line)
        if (Date.parse(item.updatedAt) >= cutoff) kept.push(line)
      } catch {}
    }
    await writeFile(this.filePath, kept.length ? `${kept.join('\n')}\n` : '', 'utf8')
  }
}
