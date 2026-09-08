import assert from 'node:assert/strict'
import test from 'node:test'
import { priorityForPath, RequestScheduler } from './tossClient.mjs'

test('domestic first-screen endpoints receive the highest priority', () => {
  assert.equal(priorityForPath('/api/v1/rankings?type=MARKET_TRADING_AMOUNT&marketCountry=KR&duration=1d&count=100'), 'critical')
  assert.equal(priorityForPath('/api/v1/market-indicators/prices?symbols=KOSPI%2CKOSDAQ'), 'critical')
  assert.equal(priorityForPath('/api/v1/prices?symbols=005930'), 'normal')
  assert.equal(priorityForPath('/api/v1/candles?symbol=005930&interval=1m&count=20'), 'background')
  assert.equal(priorityForPath('/api/v1/stocks/005930/investor-trading?count=1'), 'background')
})

test('critical work jumps ahead of queued background work', async () => {
  const scheduler = new RequestScheduler({ maxConcurrent: 1, batchSize: 20, windowMs: 100 })
  const order = []
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })

  const first = scheduler.enqueue(async () => {
    order.push('background-1')
    await firstGate
  }, { priority: 'background' })
  const second = scheduler.enqueue(async () => { order.push('background-2') }, { priority: 'background' })
  const critical = scheduler.enqueue(async () => { order.push('critical') }, { priority: 'critical' })

  releaseFirst()
  await Promise.all([first, second, critical])
  assert.deepEqual(order, ['background-1', 'critical', 'background-2'])
})

test('scheduler spreads bursts across the configured request window', async () => {
  const scheduler = new RequestScheduler({ maxConcurrent: 2, batchSize: 2, windowMs: 35 })
  const starts = []
  const tasks = Array.from({ length: 4 }, () => scheduler.enqueue(async () => { starts.push(Date.now()) }))
  await Promise.all(tasks)
  assert.equal(starts.length, 4)
  assert.ok(starts[2] - starts[0] >= 25, `expected a paced second batch, got ${starts[2] - starts[0]}ms`)
})
