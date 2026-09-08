import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PreparedSnapshotStore, compactHistoryForBrowser } from './preparedSnapshotStore.mjs'

test('writes prepared dashboard JSON atomically and skips unchanged payloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prepared-market-'))
  try {
    const store = new PreparedSnapshotStore({ directory })
    const payload = { ok: true, updatedAt: '2026-09-09T00:00:00.000Z', value: 1 }
    assert.equal(await store.write('market-snapshot.json', payload), true)
    assert.equal(await store.write('market-snapshot.json', payload), false)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'market-snapshot.json'), 'utf8')), payload)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('browser history drops heavy per-stock fields', () => {
  const compact = compactHistoryForBrowser({
    days: 8,
    resolutionMinutes: 1,
    tradingDays: 2,
    samples: [{ updatedAt: '2026-09-09T00:00:00.000Z', marketTradingAmount: 123, topRankings: [{ symbol: '005930' }] }],
  })
  assert.deepEqual(compact.samples, [{ updatedAt: '2026-09-09T00:00:00.000Z', marketTradingAmount: 123 }])
})
