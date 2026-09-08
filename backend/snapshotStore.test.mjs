import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SnapshotStore } from './snapshotStore.mjs'

test('persists a compact latest snapshot for fast startup restore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'market-snapshot-'))
  try {
    const store = new SnapshotStore({
      filePath: join(dir, 'history.jsonl'),
      latestPath: join(dir, 'latest.json'),
    })
    const snapshot = {
      ok: true,
      updatedAt: '2026-09-09T00:30:00.000Z',
      marketSession: 'KRX + NXT · 통합 장중',
      marketTradingAmount: 123456,
      marketTradingAmountCoverage: 'top100-1d',
      indices: { KOSPI: { lastPrice: 3300 } },
      topRankings: [{ symbol: '005930', name: '삼성전자', tradingAmount: 1000 }],
      stocks: {},
    }
    assert.equal(await store.maybeAppend(snapshot), true)
    const latest = await store.latest({ maxAgeHours: 48 })
    assert.equal(latest.marketTradingAmount, 123456)
    assert.equal(latest.topRankings[0].name, '삼성전자')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
