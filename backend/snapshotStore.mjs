import { mkdir, readFile, writeFile, appendFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

function minuteKey(iso) {
  return String(iso || '').slice(0, 16)
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
    topRankings: (snapshot.topRankings ?? []).slice(0, 100),
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
    const key = minuteKey(snapshot.updatedAt)
    if (!key || key === this.lastMinute) return false
    this.lastMinute = key
    await this.ready
    await appendFile(this.filePath, `${JSON.stringify(compactSnapshot(snapshot))}\n`, 'utf8')

    const day = String(snapshot.updatedAt).slice(0, 10)
    if (day && day !== this.lastPruneDay) {
      this.lastPruneDay = day
      await this.prune().catch(() => {})
    }
    return true
  }

  async read({ days = 5 } = {}) {
    await this.ready
    const safeDays = Math.max(1, Math.min(35, Number(days) || 5))
    let text = ''
    try { text = await readFile(this.filePath, 'utf8') } catch { return { days: safeDays, tradingDays: 0, samples: [] } }
    const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000
    const samples = []
    const tradingDays = new Set()
    for (const line of text.split('\n')) {
      if (!line) continue
      try {
        const item = JSON.parse(line)
        const time = Date.parse(item.updatedAt)
        if (!Number.isFinite(time) || time < cutoff) continue
        samples.push(item)
        tradingDays.add(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(time)))
      } catch {
        // 손상된 한 줄은 건너뛰고 나머지 히스토리는 유지한다.
      }
    }
    return { days: safeDays, tradingDays: tradingDays.size, samples }
  }

  async prune() {
    await this.ready
    try {
      const info = await stat(this.filePath)
      if (info.size < 25 * 1024 * 1024) return
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
