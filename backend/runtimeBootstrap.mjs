import './runtimeIntlCache.mjs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { UsThemeFlowService } from './usThemeFlowService.mjs'

const MAX_LOAD_BYTES = Math.max(1024 * 1024, Number(process.env.US_THEME_CACHE_MAX_LOAD_BYTES || 32 * 1024 * 1024))
const MAX_SYMBOLS = Math.max(10, Number(process.env.US_THEME_CACHE_MAX_SYMBOLS || 60))
const MAX_CANDLES_PER_SYMBOL = Math.max(800, Number(process.env.US_THEME_CACHE_MAX_CANDLES_PER_SYMBOL || 1600))
const PERSIST_MIN_MS = Math.max(60000, Number(process.env.US_THEME_CACHE_PERSIST_MIN_MS || 5 * 60 * 1000))

function etMinute(timestamp) {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? NaN)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? NaN)
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null
}

function trimCandles(candles = []) {
  const byTimestamp = new Map()
  for (const candle of candles) {
    const timestamp = candle?.timestamp
    const closePrice = Number(candle?.closePrice)
    const minute = etMinute(timestamp)
    if (!timestamp || !Number.isFinite(closePrice) || minute == null || minute < 570 || minute > 960) continue
    byTimestamp.set(timestamp, {
      ...candle,
      closePrice,
      volume: Number.isFinite(Number(candle?.volume)) ? Number(candle.volume) : 0,
      tradingAmount: Number.isFinite(Number(candle?.tradingAmount)) ? Number(candle.tradingAmount) : 0,
    })
  }
  return [...byTimestamp.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-MAX_CANDLES_PER_SYMBOL)
}

function latestTimestamp(candles = []) {
  let latest = 0
  for (const candle of candles) {
    const value = Date.parse(candle?.timestamp ?? '')
    if (Number.isFinite(value) && value > latest) latest = value
  }
  return latest
}

function activeSymbols(service) {
  return new Set(
    (service.payload?.themes ?? [])
      .flatMap((theme) => theme?.members ?? [])
      .map((member) => String(member?.symbol ?? '').trim())
      .filter(Boolean),
  )
}

function pruneCache(service) {
  const keep = activeSymbols(service)
  const sorted = [...service.candleCache.entries()]
    .sort((a, b) => latestTimestamp(b[1]) - latestTimestamp(a[1]))

  for (const [symbol] of sorted) {
    if (keep.size >= MAX_SYMBOLS) break
    keep.add(symbol)
  }

  let prunedSymbols = 0
  for (const [symbol, candles] of [...service.candleCache.entries()]) {
    if (!keep.has(symbol)) {
      service.candleCache.delete(symbol)
      prunedSymbols += 1
      continue
    }
    service.candleCache.set(symbol, trimCandles(candles))
  }
  service.__usCacheGuard.prunedSymbols += prunedSymbols
}

function cacheStats(service) {
  let candles = 0
  for (const items of service.candleCache.values()) candles += items?.length ?? 0
  return {
    symbols: service.candleCache.size,
    candles,
    maxSymbols: MAX_SYMBOLS,
    maxCandlesPerSymbol: MAX_CANDLES_PER_SYMBOL,
    maxLoadBytes: MAX_LOAD_BYTES,
    persistMinMs: PERSIST_MIN_MS,
    ...service.__usCacheGuard,
  }
}

const originalRefresh = UsThemeFlowService.prototype.refresh

UsThemeFlowService.prototype.loadPersistedCache = async function loadPersistedCacheGuarded() {
  if (this.cacheLoaded) return
  this.cacheLoaded = true
  this.__usCacheGuard ??= {
    loadSkippedOversize: false,
    skippedBytes: 0,
    loadedSymbols: 0,
    prunedSymbols: 0,
    lastPersistAt: 0,
  }

  try {
    const info = await stat(this.cachePath)
    if (info.size > MAX_LOAD_BYTES) {
      this.__usCacheGuard.loadSkippedOversize = true
      this.__usCacheGuard.skippedBytes = info.size
      console.warn(`[market-backend] skipped oversized US theme cache: ${info.size} bytes`)
      return
    }

    const saved = JSON.parse(await readFile(this.cachePath, 'utf8'))
    const entries = Object.entries(saved?.candles ?? {})
      .filter(([, candles]) => Array.isArray(candles) && candles.length)
      .sort((a, b) => latestTimestamp(b[1]) - latestTimestamp(a[1]))
      .slice(0, MAX_SYMBOLS)

    for (const [symbol, candles] of entries) this.candleCache.set(symbol, trimCandles(candles))
    this.__usCacheGuard.loadedSymbols = this.candleCache.size
  } catch {
    // Missing/corrupt cache falls back to Toss backfill without blocking startup.
  }
}

UsThemeFlowService.prototype.persistCache = async function persistCacheGuarded() {
  this.__usCacheGuard ??= {
    loadSkippedOversize: false,
    skippedBytes: 0,
    loadedSymbols: 0,
    prunedSymbols: 0,
    lastPersistAt: 0,
  }
  const now = Date.now()
  if (this.__usCacheGuard.lastPersistAt && now - this.__usCacheGuard.lastPersistAt < PERSIST_MIN_MS) return

  pruneCache(this)
  await mkdir(dirname(this.cachePath), { recursive: true })
  const payload = {
    version: 2,
    savedAt: new Date(now).toISOString(),
    candles: Object.fromEntries([...this.candleCache.entries()]),
  }
  const tempPath = `${this.cachePath}.tmp`
  await writeFile(tempPath, JSON.stringify(payload), 'utf8')
  await rename(tempPath, this.cachePath)
  this.__usCacheGuard.lastPersistAt = now
  this.__usCacheGuard.loadSkippedOversize = false
  this.__usCacheGuard.skippedBytes = 0
}

UsThemeFlowService.prototype.refresh = async function refreshWithCacheDiagnostics(...args) {
  this.__usCacheGuard ??= {
    loadSkippedOversize: false,
    skippedBytes: 0,
    loadedSymbols: 0,
    prunedSymbols: 0,
    lastPersistAt: 0,
  }
  const payload = await originalRefresh.apply(this, args)
  if (payload && typeof payload === 'object') {
    payload.cache = cacheStats(this)
    payload.criteria = {
      ...(payload.criteria ?? {}),
      cacheGuard: 'oversize-skip + 60-symbol cap + 1600-candle cap + 5m-persist-throttle',
    }
    this.payload = payload
  }
  return payload
}

await import('./server.mjs')
