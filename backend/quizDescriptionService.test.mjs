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

test('ignores the real-time overview label and starts from the actual company overview body', () => {
  const html = `
    <html><body>
      <div>2026.09.09 기준 실시간 기업개요</div>
      <h4>기업개요</h4>
      <div>동사는 검색, 광고, 커머스, 핀테크와 클라우드 플랫폼 사업을 영위함.</div>
      <div>AI와 데이터센터 인프라 투자를 확대하고 있음.</div>
      <p>출처 : 에프앤가이드</p>
    </body></html>`
  assert.equal(
    extractCompanyOverview(html),
    '동사는 검색, 광고, 커머스, 핀테크와 클라우드 플랫폼 사업을 영위함. AI와 데이터센터 인프라 투자를 확대하고 있음.',
  )
})

test('returns null when no company overview exists', () => {
  assert.equal(extractCompanyOverview('<html><body>시세정보만 있음</body></html>'), null)
})

test('preferred-share code falls back to its common-share overview when direct pages have no overview', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quiz-description-pref-'))
  const cachePath = path.join(dir, 'quiz-descriptions.json')
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url) => {
    calls.push(String(url))
    const isCommon = String(url).includes('005930')
    const body = isCommon
      ? '<h4>기업개요</h4><div>동사는 반도체, 스마트폰, 가전 사업을 영위하는 종합 전자기업임.</div><div>메모리와 파운드리 사업을 운영함.</div><p>출처 : 에프앤가이드</p>'
      : '<html><body>우선주 시세정보만 있음</body></html>'
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }

  try {
    const service = new QuizDescriptionService({
      cachePath,
      bootstrapDelayMs: 60_000,
      bootstrapMaxAttempts: 0,
    })
    const payload = await service.getMany(['005935'])
    assert.equal(payload.ok, true)
    assert.equal(payload.complete, true)
    assert.match(payload.items[0].description, /반도체, 스마트폰, 가전/)
    assert.equal(payload.items[0].sourceCode, '005930')
    assert.ok(calls.some((url) => url.includes('005935')))
    assert.ok(calls.some((url) => url.includes('005930')))
  } finally {
    globalThis.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('prepared quiz cache joins stock name, pool and cached description without external fetch', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quiz-prepared-'))
  const cachePath = path.join(dir, 'quiz-descriptions.json')
  const universeCachePath = path.join(dir, 'quiz-universe.json')
  const preparedPath = path.join(dir, 'quiz-prepared.json')
  const fetchedAt = new Date().toISOString()

  await fs.writeFile(cachePath, JSON.stringify({
    version: 1,
    items: {
      '005930': {
        code: '005930',
        description: '메모리와 시스템 반도체, 스마트폰 등을 생산하는 기업임.',
        source: 'cached-test',
        fetchedAt,
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
    throw new Error('external fetch must not run while publishing existing cache')
  }

  try {
    const service = new QuizDescriptionService({
      cachePath,
      universeCachePath,
      preparedPath,
      bootstrapDelayMs: 60_000,
      bootstrapMaxAttempts: 0,
    })
    const prepared = await service.publishPrepared()
    assert.equal(prepared.kospi200.length, 1)
    assert.equal(prepared.kospi200[0].code, '005930')
    assert.equal(prepared.kospi200[0].name, '삼성전자')
    assert.equal(prepared.kospi200[0].pool, 'kospi200')
    assert.equal(prepared.kospi200[0].description, '메모리와 시스템 반도체, 스마트폰 등을 생산하는 기업임.')
    assert.equal(prepared.counts.ready, 1)
    assert.equal(externalCalls, 0)

    const written = JSON.parse(await fs.readFile(preparedPath, 'utf8'))
    assert.equal(written.kospi200[0].name, '삼성전자')
    assert.equal(written.kospi200[0].description, '메모리와 시스템 반도체, 스마트폰 등을 생산하는 기업임.')
  } finally {
    globalThis.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})
