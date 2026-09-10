import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { QuizDescriptionService } from './quizDescriptionService.mjs'
import { prioritizeQuizTargets, recoverQuizUniverseFromDescriptionCache } from './quizRuntimeBootstrap.mjs'

test('quiz targets alternate KOSPI 200 and KOSDAQ 150 so both pools become playable early', () => {
  const kospi200 = Array.from({ length: 5 }, (_, index) => ({ code: String(100001 + index), name: `코스피${index}`, pool: 'kospi200' }))
  const kosdaq150 = Array.from({ length: 4 }, (_, index) => ({ code: String(200001 + index), name: `코스닥${index}`, pool: 'kosdaq150' }))
  const targets = prioritizeQuizTargets({ kospi200, kosdaq150 })

  assert.deepEqual(targets.slice(0, 8).map((item) => item.pool), [
    'kospi200', 'kosdaq150', 'kospi200', 'kosdaq150',
    'kospi200', 'kosdaq150', 'kospi200', 'kosdaq150',
  ])
  assert.equal(targets.length, 9)
})

test('description cache restores a playable quiz universe when live index sources are unavailable', () => {
  const cache = new Map()
  for (let index = 0; index < 6; index += 1) {
    cache.set(`1${String(index).padStart(5, '0')}`, {
      code: `1${String(index).padStart(5, '0')}`,
      name: `코스피캐시${index}`,
      pool: 'kospi200',
      description: '코스피 기업설명',
    })
    cache.set(`2${String(index).padStart(5, '0')}`, {
      code: `2${String(index).padStart(5, '0')}`,
      name: `코스닥캐시${index}`,
      pool: 'kosdaq150',
      description: '코스닥 기업설명',
    })
  }
  cache.set('300001', { code: '300001', name: '소속없음', pool: null, description: '제외' })
  cache.set('300002', { code: '300002', name: '설명없음', pool: 'kospi200', description: null })

  const recovered = recoverQuizUniverseFromDescriptionCache({ cache })
  assert.ok(recovered)
  assert.equal(recovered.payload.universeMode, 'description-cache-recovery')
  assert.equal(recovered.kospi200.length, 6)
  assert.equal(recovered.kosdaq150.length, 6)
  assert.deepEqual(recovered.targets.slice(0, 4).map((item) => item.pool), ['kospi200', 'kosdaq150', 'kospi200', 'kosdaq150'])
})

test('description cache recovery refuses to pretend a pool is playable with fewer than four stocks', () => {
  const cache = new Map([
    ['100001', { code: '100001', name: '코스피1', pool: 'kospi200', description: '설명' }],
    ['100002', { code: '100002', name: '코스피2', pool: 'kospi200', description: '설명' }],
    ['100003', { code: '100003', name: '코스피3', pool: 'kospi200', description: '설명' }],
    ['200001', { code: '200001', name: '코스닥1', pool: 'kosdaq150', description: '설명' }],
    ['200002', { code: '200002', name: '코스닥2', pool: 'kosdaq150', description: '설명' }],
    ['200003', { code: '200003', name: '코스닥3', pool: 'kosdaq150', description: '설명' }],
    ['200004', { code: '200004', name: '코스닥4', pool: 'kosdaq150', description: '설명' }],
  ])
  assert.equal(recoverQuizUniverseFromDescriptionCache({ cache }), null)
})

test('runtime bootstrap fetches the index universe itself when the Pi cache is missing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quiz-runtime-bootstrap-'))
  const cachePath = path.join(dir, 'quiz-descriptions.json')
  const universeCachePath = path.join(dir, 'quiz-universe.json')
  const preparedPath = path.join(dir, 'quiz-prepared.json')
  const originalFetch = globalThis.fetch

  const makeRows = (base, label) => Array.from({ length: 60 }, (_, index) => ({
    ISU_SRT_CD: String(base + index).padStart(6, '0'),
    ISU_ABBRV: `${label}${index + 1}`,
  }))

  globalThis.fetch = async (url, options = {}) => {
    const value = String(url)
    if (value.includes('executeForResourceBundle.cmd')) {
      return new Response(JSON.stringify({ result: { output: [{ bis_work_dt: '20260909' }] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (value.includes('getJsonData.cmd')) {
      const body = options.body instanceof URLSearchParams ? options.body : new URLSearchParams(String(options.body ?? ''))
      const isKospi = body.get('indIdx') === '1'
      return new Response(JSON.stringify({ output: isKospi ? makeRows(100001, '코스피기업') : makeRows(200001, '코스닥기업') }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected URL: ${value}`)
  }

  try {
    const service = new QuizDescriptionService({
      cachePath,
      universeCachePath,
      preparedPath,
      bootstrapDelayMs: 60_000,
      bootstrapMaxAttempts: 0,
    })
    let captured = []
    service.prewarm = async (targets) => {
      captured = targets
      return { running: false, targetCount: targets.length }
    }

    const result = await service.bootstrapPrewarm({ retries: 1, retryMs: 0 })
    assert.equal(result.targetCount, 120)
    assert.equal(captured.length, 120)
    assert.equal(captured[0].pool, 'kospi200')
    assert.equal(captured[1].pool, 'kosdaq150')

    const universe = JSON.parse(await fs.readFile(universeCachePath, 'utf8'))
    assert.equal(universe.ok, true)
    assert.equal(universe.kospi200.length, 60)
    assert.equal(universe.kosdaq150.length, 60)

    const prepared = JSON.parse(await fs.readFile(preparedPath, 'utf8'))
    assert.equal(prepared.cacheStatus.targetCount, 120)
    clearTimeout(service.bootstrapTimer)
  } finally {
    globalThis.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})
