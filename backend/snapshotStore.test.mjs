import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SnapshotStore } from './snapshotStore.mjs'

function sample(updatedAt, marketTradingAmount) {
  return {
    ok: true,
    updatedAt,
    marketSession: 'KRX + NXT · 통합 장중',
    marketTradingAmount,
    marketTradingAmountCoverage: 'top100-1d',
    indices: { KOSPI: { lastPrice: 3300 } },
    topRankings: [{ symbol: '005930', name: '삼성전자', tradingAmount: 1000 }],
    stocks: {
      '005930': { symbol: '005930', name: '삼성전자', lastPrice: 70000, changeRate: 1.2, tradingAmount: 1000 },
    },
  }
}

test('persists a compact latest snapshot for fast startup restore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'market-snapshot-'))
  try {
    const historyPath = join(dir, 'history.jsonl')
    const store = new SnapshotStore({
      filePath: historyPath,
      latestPath: join(dir, 'latest.json'),
    })
    const snapshot = sample('2026-09-09T00:30:00.000Z', 123456)
    assert.equal(await store.maybeAppend(snapshot), true)
    const latest = await store.latest({ maxAgeHours: 48 })
    assert.equal(latest.marketTradingAmount, 123456)
    assert.equal(latest.topRankings[0].name, '삼성전자')
    assert.equal(latest.stocks['005930'].name, '삼성전자')

    const historyRow = JSON.parse((await readFile(historyPath, 'utf8')).trim())
    assert.equal(historyRow.topRankings[0].name, '삼성전자')
    assert.equal('stocks' in historyRow, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('keeps an already loaded one-minute history cache updated incrementally', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'market-history-cache-'))
  try {
    const store = new SnapshotStore({
      filePath: join(dir, 'history.jsonl'),
      latestPath: join(dir, 'latest.json'),
    })
    const initial = await store.read({ days: 8, resolutionMinutes: 1 })
    assert.equal(initial.samples.length, 0)

    await store.maybeAppend(sample('2026-09-09T00:30:00.000Z', 100))
    await store.maybeAppend(sample('2026-09-09T00:31:00.000Z', 120))

    const updated = await store.read({ days: 8, resolutionMinutes: 1 })
    assert.equal(updated.samples.length, 2)
    assert.deepEqual(updated.samples.map((item) => item.marketTradingAmount), [100, 120])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('reads only a bounded recent tail from an oversized history file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'market-history-tail-'))
  try {
    const historyPath = join(dir, 'history.jsonl')
    const latestPath = join(dir, 'latest.json')
    const filler = `${JSON.stringify({ updatedAt: '2026-09-08T00:00:00.000Z', padding: 'x'.repeat(2048) })}\n`
    await writeFile(historyPath, filler.repeat(2600), 'utf8')

    const recent = sample('2026-09-09T00:30:00.000Z', 777)
    await writeFile(historyPath, `${await readFile(historyPath, 'utf8')}${JSON.stringify(recent)}\n`, 'utf8')

    const store = new SnapshotStore({
      filePath: historyPath,
      latestPath,
      maxReadBytes: 4 * 1024 * 1024,
      pruneThresholdBytes: 16 * 1024 * 1024,
    })
    const payload = await store.read({ days: 2, resolutionMinutes: 1 })
    const stats = store.diagnostics()

    assert.equal(payload.truncated, true)
    assert.ok(stats.bytesRead <= 4 * 1024 * 1024)
    assert.equal(payload.samples.at(-1).marketTradingAmount, 777)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
