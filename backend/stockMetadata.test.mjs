import test from 'node:test'
import assert from 'node:assert/strict'
import { StockMetadataCache, directNameFromRanking, validStockName } from './stockMetadata.mjs'

test('numeric symbol is never accepted as a stock name', () => {
  assert.equal(validStockName('005930', '005930'), null)
  assert.equal(validStockName('', '005930'), null)
  assert.equal(validStockName('삼성전자', '005930'), '삼성전자')
  assert.equal(directNameFromRanking({ symbol: '005930', displayName: '삼성전자' }), '삼성전자')
})

test('metadata cache requests TOP100 in small chunks and resolves displayName', async () => {
  const calls = []
  const client = {
    async request(path) {
      calls.push(path)
      const params = new URL(`https://example.com${path}`).searchParams
      const symbols = decodeURIComponent(params.get('symbols') ?? '').split(',').filter(Boolean)
      return { result: { stocks: symbols.map((symbol) => ({ symbol, displayName: `종목-${symbol}`, securityType: 'STOCK' })) } }
    },
  }
  const symbols = Array.from({ length: 60 }, (_, index) => String(index + 1).padStart(6, '0'))
  const cache = new StockMetadataCache({ chunkSize: 25 })
  await cache.ensure(client, symbols)

  assert.equal(calls.length, 3)
  assert.equal(cache.get('000001')?.name, '종목-000001')
  assert.equal(cache.get('000060')?.name, '종목-000060')
})


test('metadata cache retries names omitted by a batch response with single-symbol requests', async () => {
  const calls = []
  const client = {
    async request(path) {
      calls.push(path)
      const params = new URL(`https://example.com${path}`).searchParams
      const symbols = decodeURIComponent(params.get('symbols') ?? '').split(',').filter(Boolean)
      if (symbols.length > 1) {
        return { result: { stocks: symbols.map((symbol) => ({ symbol, displayName: null, securityType: 'STOCK' })) } }
      }
      return { result: { stocks: symbols.map((symbol) => ({ symbol, displayName: symbol === '005930' ? '삼성전자' : 'SK하이닉스', securityType: 'STOCK' })) } }
    },
  }

  const cache = new StockMetadataCache({ chunkSize: 10, unresolvedRetryMs: 0 })
  await cache.ensure(client, ['005930', '000660'])

  assert.equal(cache.get('005930')?.name, '삼성전자')
  assert.equal(cache.get('000660')?.name, 'SK하이닉스')
  assert.equal(calls.length, 3)
})
