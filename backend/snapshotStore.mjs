import { mkdir, readFile, writeFile, appendFile, stat, rename, open } from 'node:fs/promises'
import { dirname } from 'node:path'

const DEFAULT_MAX_READ_BYTES = 32 * 1024 * 1024
const DEFAULT_PRUNE_THRESHOLD_BYTES = 256 * 1024 * 1024
const DEFAULT_PRUNE_KEEP_BYTES = 96 * 1024 * 1024

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

function bucketInfo(iso, resolutionMinutes) {
  const { day, hour, minute } = kstParts(iso)
  const marketMinute = hour * 60 + minute
  if (marketMinute < 480 || marketMinute > 1200) return null
  return {
    day,
    bucket: Math.floor((marketMinute - 480) / resolutionMinutes),
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

function compactHistorySnapshot(snapshot) {
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
  }
}

function compactLatestSnapshot(snapshot) {
  return {
    ...compactHistorySnapshot(snapshot),
    stocks: Object.fromEntries(Object.entries(snapshot.stocks ?? {}).map(([symbol, stock]) => [symbol, compactStock(stock)])),
  }
}

async function readTailText(filePath, maxBytes) {
  const handle = await open(filePath, 'r')
  try {
    const info = await handle.stat()
    const safeMax = Math.max(1024 * 1024, Number(maxBytes) || DEFAULT_MAX_READ_BYTES)
    const start = Math.max(0, info.size - safeMax)
    const length = Math.max(0, info.size - start)
    if (!length) return { text: '', sourceBytes: info.size, bytesRead: 0, truncated: false }

    const buffer = Buffer.allocUnsafe(length)
    let offset = 0
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset)
      if (!bytesRead) break
      offset += bytesRead
    }

    let text = buffer.subarray(0, offset).toString('utf8')
    if (start > 0) {
      const newline = text.indexOf('\n')
      text = newline >= 0 ? text.slice(newline + 1) : ''
    }
    return { text, sourceBytes: info.size, bytesRead: offset, truncated: start > 0 }
  } finally {
    await handle.close().catch(() => {})
  }
}

export class SnapshotStore {
  constructor({
    filePath = process.env.MARKET_HISTORY_PATH || '/app/data/market-history.jsonl',
    latestPath = process.env.MARKET_LATEST_PATH || '/app/data/latest-market-snapshot.json',
    retainDays = 35,
    maxReadBytes = Number(process.env.MARKET_HISTORY_READ_MAX_BYTES || DEFAULT_MAX_READ_BYTES),
    pruneThresholdBytes = Number(process.env.MARKET_HISTORY_PRUNE_THRESHOLD_BYTES || DEFAULT_PRUNE_THRESHOLD_BYTES),
    pruneKeepBytes = Number(process.env.MARKET_HISTORY_PRUNE_KEEP_BYTES || DEFAULT_PRUNE_KEEP_BYTES),
  } = {}) {
    this.filePath = filePath
    this.latestPath = latestPath
    this.retainDays = retainDays
    this.maxReadBytes = Math.max(4 * 1024 * 1024, maxReadBytes)
    this.pruneThresholdBytes = Math.max(this.maxReadBytes * 2, pruneThresholdBytes)
    this.pruneKeepBytes = Math.max(this.maxReadBytes, Math.min(pruneKeepBytes, this.pruneThresholdBytes))
    this.lastMinute = null
    this.lastPruneDay = null
    this.readCache = new Map()
    this.lastReadStats = { sourceBytes: 0, bytesRead: 0, truncated: false }
    this.ready = Promise.all([
      mkdir(dirname(filePath), { recursive: true }),
      mkdir(dirname(latestPath), { recursive: true }),
    ]).catch(() => {})
  }

  async writeLatest(compact) {
    const temp = `${this.latestPath}.tmp`
    await writeFile(temp, JSON.stringify(compact), 'utf8')
    await rename(temp, this.latestPath)
  }

  async latest({ maxAgeHours = 36 } = {}) {
    await this.ready
    try {
      const item = JSON.parse(await readFile(this.latestPath, 'utf8'))
      const time = Date.parse(item?.updatedAt)
      if (!Number.isFinite(time)) return null
      if (Date.now() - time > Math.max(1, Number(maxAgeHours) || 36) * 60 * 60 * 1000) return null
      return item
    } catch {
      return null
    }
  }

  diagnostics() {
    return {
      maxReadBytes: this.maxReadBytes,
      pruneThresholdBytes: this.pruneThresholdBytes,
      pruneKeepBytes: this.pruneKeepBytes,
      ...this.lastReadStats,
      cachedViews: this.readCache.size,
    }
  }

  updateReadCaches(compact) {
    const time = Date.parse(compact?.updatedAt)
    if (!Number.isFinite(time)) return

    for (const [cacheKey, result] of this.readCache.entries()) {
      const [daysText, resolutionText] = cacheKey.split(':')
      const days = Number(daysText) || 5
      const resolutionMinutes = Number(resolutionText) || 5
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
      if (time < cutoff) continue

      const info = bucketInfo(compact.updatedAt, resolutionMinutes)
      if (!info) continue
      const bucketKey = `${info.day}:${info.bucket}`
      let replaced = false
      for (let index = result.samples.length - 1; index >= 0; index -= 1) {
        const sample = result.samples[index]
        if (Date.parse(sample.updatedAt) < cutoff) break
        const sampleInfo = bucketInfo(sample.updatedAt, resolutionMinutes)
        if (`${sampleInfo?.day}:${sampleInfo?.bucket}` === bucketKey) {
          result.samples[index] = compact
          replaced = true
          break
        }
      }
      if (!replaced) result.samples.push(compact)
      result.samples = result.samples.filter((sample) => Date.parse(sample.updatedAt) >= cutoff)
      result.tradingDays = new Set(result.samples.map((sample) => kstParts(sample.updatedAt).day)).size
    }
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

    // History rows are deliberately lighter than the startup snapshot. The TOP100
    // already contains the per-stock fields needed by replay; duplicating snapshot.stocks
    // made the JSONL file grow much faster on the Raspberry Pi.
    const historyCompact = compactHistorySnapshot(snapshot)
    await appendFile(this.filePath, `${JSON.stringify(historyCompact)}\n`, 'utf8')
    this.updateReadCaches(historyCompact)
    await this.writeLatest(compactLatestSnapshot(snapshot)).catch(() => {})

    // Never prune on the first intraday append after a restart. Old code could read and
    // rewrite a 250MB+ JSONL file while the HTTP server was serving requests, saturating
    // one Pi CPU core and producing nginx 504s. Maintenance is only attempted near the
    // end of the extended session and itself keeps only a bounded recent tail.
    const day = kstParts(snapshot.updatedAt).day
    if (day && day !== this.lastPruneDay && marketMinute >= 1195) {
      this.lastPruneDay = day
      await this.prune().catch(() => {})
    }
    return true
  }

  async read({ days = 5, resolutionMinutes = 5 } = {}) {
    await this.ready
    const safeDays = Math.max(1, Math.min(35, Number(days) || 5))
    const safeResolution = Math.max(1, Math.min(30, Number(resolutionMinutes) || 5))
    const cacheKey = `${safeDays}:${safeResolution}`
    const cached = this.readCache.get(cacheKey)
    if (cached) return cached

    let tail
    try {
      tail = await readTailText(this.filePath, this.maxReadBytes)
      this.lastReadStats = {
        sourceBytes: tail.sourceBytes,
        bytesRead: tail.bytesRead,
        truncated: tail.truncated,
      }
    } catch {
      const empty = { days: safeDays, resolutionMinutes: safeResolution, tradingDays: 0, samples: [], boundedRead: true }
      this.readCache.set(cacheKey, empty)
      return empty
    }

    const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000
    const buckets = new Map()
    const tradingDays = new Set()
    const lines = tail.text.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!line) continue
      try {
        const item = JSON.parse(line)
        const time = Date.parse(item.updatedAt)
        if (!Number.isFinite(time) || time < cutoff) continue
        const info = bucketInfo(item.updatedAt, safeResolution)
        if (!info) continue
        buckets.set(`${info.day}:${info.bucket}`, item)
        tradingDays.add(info.day)
      } catch {
        // 손상된 한 줄은 건너뛰고 나머지 히스토리는 유지한다.
      }
      if (index > 0 && index % 250 === 0) await new Promise((resolve) => setImmediate(resolve))
    }
    const samples = [...buckets.values()].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    const result = {
      days: safeDays,
      resolutionMinutes: safeResolution,
      tradingDays: tradingDays.size,
      samples,
      boundedRead: true,
      sourceBytes: tail.sourceBytes,
      bytesRead: tail.bytesRead,
      truncated: tail.truncated,
    }
    this.readCache.set(cacheKey, result)
    return result
  }

  async prune() {
    await this.ready
    let info
    try {
      info = await stat(this.filePath)
      if (info.size < this.pruneThresholdBytes) return false
    } catch {
      return false
    }

    // Bounded compaction: read only the newest tail instead of loading the entire file.
    // This intentionally prioritizes recent replay data and Pi availability over keeping
    // an ever-growing JSONL file in the active path.
    const tail = await readTailText(this.filePath, this.pruneKeepBytes)
    const cutoff = Date.now() - this.retainDays * 24 * 60 * 60 * 1000
    const kept = []
    const lines = tail.text.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!line) continue
      try {
        const item = JSON.parse(line)
        if (Date.parse(item.updatedAt) >= cutoff) kept.push(line)
      } catch {}
      if (index > 0 && index % 250 === 0) await new Promise((resolve) => setImmediate(resolve))
    }
    const temp = `${this.filePath}.prune.tmp`
    await writeFile(temp, kept.length ? `${kept.join('\n')}\n` : '', 'utf8')
    await rename(temp, this.filePath)
    this.readCache.clear()
    this.lastReadStats = { sourceBytes: info.size, bytesRead: tail.bytesRead, truncated: tail.truncated }
    return true
  }
}
