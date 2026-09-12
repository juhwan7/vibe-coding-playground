import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ThemeFlowServiceFive } from './themeFlowServiceFive.mjs'

function candle(timestamp, closePrice = 100) {
  return { timestamp, openPrice: closePrice, highPrice: closePrice, lowPrice: closePrice, closePrice, volume: 1, tradingAmount: closePrice }
}

test('oversized persisted theme cache is skipped instead of parsed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'theme-cache-guard-'))
  const cachePath = join(dir, 'theme-candles.json')
  try {
    await writeFile(cachePath, JSON.stringify({ padding: 'x'.repeat(4096), candles: { '005930': [candle('2026-09-09T00:00:00.000Z')] } }))
    const service = new ThemeFlowServiceFive({ configured: false }, () => null, {
      cachePath,
      maxCacheLoadBytes: 1024,
      maxCacheSymbols: 5,
      persistMinMs: 0,
    })

    await service.loadPersistedCache()

    assert.equal(service.candleCache.size, 0)
    assert.equal(service.cacheStats().loadSkippedOversize, true)
    assert.ok(service.cacheStats().skippedBytes > 1024)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('theme cache pruning retains active symbols and caps retained symbol count', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'theme-cache-prune-'))
  const cachePath = join(dir, 'theme-candles.json')
  try {
    const service = new ThemeFlowServiceFive({ configured: false }, () => null, {
      cachePath,
      maxCacheSymbols: 5,
      maxCandlesPerSymbol: 400,
      persistMinMs: 0,
    })

    for (let index = 0; index < 8; index += 1) {
      const symbol = String(index + 1).padStart(6, '0')
      service.candleCache.set(symbol, [candle(`2026-09-09T0${index}:00:00.000Z`, 100 + index)])
    }

    service.activeChartSymbols = ['000001', '000002']
    service.pruneCandleCache(service.activeChartSymbols)

    assert.ok(service.candleCache.has('000001'))
    assert.ok(service.candleCache.has('000002'))
    assert.equal(service.candleCache.size, 5)

    await service.persistCache({ force: true })
    const saved = JSON.parse(await readFile(cachePath, 'utf8'))
    assert.equal(saved.version, 7)
    assert.equal(Object.keys(saved.candles).length, 5)
    assert.deepEqual(saved.extendedQuoteSamples, {})
    assert.deepEqual(saved.extendedQuoteCounters, {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})