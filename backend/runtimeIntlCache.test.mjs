import assert from 'node:assert/strict'
import test from 'node:test'
import { installRuntimeIntlCache, runtimeIntlCacheStats } from './runtimeIntlCache.mjs'

test('runtime Intl cache preserves KST date formatting and reuses formatter/value results', () => {
  installRuntimeIntlCache()
  const before = { ...(runtimeIntlCacheStats() ?? {}) }
  const timestamp = new Date('2026-09-09T00:15:00.000Z')
  const options = { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }

  const first = new Intl.DateTimeFormat('en-CA', options).format(timestamp)
  const second = new Intl.DateTimeFormat('en-CA', options).format(timestamp)

  assert.equal(first, '2026-09-09')
  assert.equal(second, first)
  const after = runtimeIntlCacheStats()
  assert.ok(after.formatterHits >= (before.formatterHits ?? 0) + 1)
  assert.ok(after.formatHits >= (before.formatHits ?? 0) + 1)
})

test('runtime Intl cache preserves timezone formatToParts results', () => {
  installRuntimeIntlCache()
  const timestamp = new Date('2026-07-01T14:30:00.000Z')
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const first = formatter.formatToParts(timestamp)
  const second = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(timestamp)

  const value = (parts, type) => parts.find((part) => part.type === type)?.value
  assert.equal(value(first, 'hour'), '10')
  assert.equal(value(first, 'minute'), '30')
  assert.deepEqual(second, first)
})
