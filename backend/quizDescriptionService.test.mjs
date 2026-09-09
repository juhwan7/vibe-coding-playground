import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { QuizDescriptionService, extractCompanyOverview } from './quizDescriptionService.mjs'

test('extracts the company overview section without surrounding page text', () => {
  const html = `
    <html><body>
      <h4>기업개요</h4>
      <div>동사는 메모리 반도체와 시스템 반도체를 생산하는 기업임.</div>
      <div>주요 제품은 HBM, DRAM, NAND이며 글로벌 고객사에 공급함.</div>
      <p>출처 : 에프앤가이드</p>
      <div>시세정보</div>
    </body></html>`
  assert.equal(
    extractCompanyOverview(html),
    '동사는 메모리 반도체와 시스템 반도체를 생산하는 기업임. 주요 제품은 HBM, DRAM, NAND이며 글로벌 고객사에 공급함.',
  )
})

test('returns null when no company overview exists', () => {
  assert.equal(extractCompanyOverview('<html><body>시세정보만 있음</body></html>'), null)
})

test('quiz cache joins stock name, pool and description without external fetch', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quiz-cache-'))
  const cachePath = path.join(dir, 'quiz-descriptions.json')
  const universeCachePath = path.join(dir, 'quiz-universe.json')
  const preparedPath = path.join(dir, 'quiz-prepared.json')

  await fs.writeFile(cachePath, JSON.stringify({
    version: 2,
    items: {
      '005930': {
        code: '005930',
        description: '메모리와 시스템 반도체, 스마트폰 등을 생산하는 기업임.',
        source: 'cached-test',
        fetchedAt: new Date().toISOString(),
      },
    },
  }), 'utf8')
  await fs.writeFile(universeCachePath, JSON.stringify({
    ok: true,
    sourceDate: '20260909',
    kospi200: [
      { code: '005930', name: '삼성전자' },
      { code: '000660', name: 'SK하이닉스' },
    ],
    kosdaq150: [{ code: '196170', name: '알테오젠' }],
  }), 'utf8')

  const originalFetch = globalThis.fetch
  let externalCalls = 0
  globalThis.fetch = async () => {
    externalCalls += 1
    throw new Error('external fetch must not run')
  }

  try {
    const service = new QuizDescriptionService({
      cachePath,
      universeCachePath,
      preparedPath,
      bootstrapDelayMs: 60_000,
      bootstrapMaxAttempts: 0,
    })

    const cached = await service.getMany(['005930'])
    assert.equal(cached.ok, true)
    assert.equal(cached.cacheOnly, true)
    assert.equal(cached.items[0].description, '메모리와 시스템 반도체, 스마트폰 등을 생산하는 기업임.')
    assert.deepEqual(cached.readyCodes, ['005930'])

    const prepared = await service.getPrepared()
    assert.equal(prepared.ok, true)
    assert.equal(prepared.kospi200.length, 1)
    assert.equal(prepared.kospi200[0].code, '005930')
    assert.equal(prepared.kospi200[0].name, '삼성전자')
    assert.equal(prepared.kospi200[0].pool, 'kospi200')
    assert.equal(prepared.kospi200[0].description, '메모리와 시스템 반도체, 스마트폰 등을 생산하는 기업임.')

    const written = JSON.parse(await fs.readFile(preparedPath, 'utf8'))
    assert.equal(written.kospi200[0].name, '삼성전자')
    assert.equal(written.counts.ready, 1)

    const missing = await service.getMany(['000660'])
    assert.equal(missing.ok, false)
    assert.equal(missing.cacheOnly, true)
    assert.equal(missing.items[0].description, null)
    assert.equal(externalCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})
