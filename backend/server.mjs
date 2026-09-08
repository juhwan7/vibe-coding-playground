import http from 'node:http'
import { MarketCollector } from './marketCollector.mjs'
import { SnapshotStore } from './snapshotStore.mjs'
import { PreparedSnapshotStore, compactHistoryForBrowser } from './preparedSnapshotStore.mjs'
import { ThemeFlowService } from './themeFlowService.mjs'
import { UsThemeFlowService } from './usThemeFlowService.mjs'
import { QuizUniverseService } from './quizUniverseService.mjs'
import { QuizDescriptionService } from './quizDescriptionService.mjs'
import { FeatureNewsService } from './featureNewsService.mjs'
import { TossClient } from './tossClient.mjs'

const port = Number(process.env.PORT || 8787)
const client = new TossClient({
  clientId: process.env.TOSS_CLIENT_ID,
  clientSecret: process.env.TOSS_CLIENT_SECRET,
})
const collector = new MarketCollector(client, {
  fastMs: Number(process.env.POLL_MS || 60000),
  slowMs: Number(process.env.SLOW_POLL_MS || 180000),
})
const history = new SnapshotStore()
const prepared = new PreparedSnapshotStore()
const themeFlow = new ThemeFlowService(client, () => collector.snapshot, {
  refreshMs: Number(process.env.THEME_FLOW_REFRESH_MS || 60000),
  cachePath: process.env.THEME_CANDLE_CACHE_PATH || '/app/data/theme-candles.json',
})
const usThemeFlow = new UsThemeFlowService(client, {
  refreshMs: Number(process.env.US_THEME_FLOW_REFRESH_MS || 60000),
  cachePath: process.env.US_THEME_CANDLE_CACHE_PATH || '/app/data/us-theme-candles.json',
})
const quizUniverse = new QuizUniverseService({ cachePath: process.env.QUIZ_UNIVERSE_CACHE_PATH || '/app/data/quiz-universe.json' })
const quizDescriptions = new QuizDescriptionService({ cachePath: process.env.QUIZ_DESCRIPTION_CACHE_PATH || '/app/data/quiz-descriptions.json' })
const featureNews = new FeatureNewsService({ refreshMs: Number(process.env.FEATURE_NEWS_REFRESH_MS || 180000) })
let historyTimer = null
let preparedTimer = null
let preparedHistoryTimer = null
let newsTimer = null
let krThemeStartTimer = null
let usThemeStartTimer = null
let manualRefreshPromise = null

function fundingStatus() {
  const configured = Boolean(process.env.DATA_GO_KR_SERVICE_KEY)
  return {
    ok: false,
    configured,
    source: '금융위원회_금융투자협회종합통계정보',
    sourceDataset: 'data.go.kr 15094809',
    frequency: '일간/T+1',
    investorDeposits: null,
    cmaBalance: null,
    creditBalance: null,
    unsettledReceivables: null,
    updatedAt: null,
    note: configured
      ? '공공데이터 서비스키는 설정되어 있으나 세부 자금 API 연결은 아직 준비 중입니다.'
      : '공식 공공데이터 서비스키가 연결되기 전에는 주변자금 값을 임의로 표시하지 않습니다.',
  }
}

async function publishPreparedFast() {
  const writes = []
  if (collector.snapshot) writes.push(prepared.write('market-snapshot.json', collector.snapshot))
  if (themeFlow.payload?.ok) writes.push(prepared.write('kr-theme-flow.json', themeFlow.payload))
  if (usThemeFlow.payload?.ok) writes.push(prepared.write('us-theme-flow.json', usThemeFlow.payload))
  if (featureNews.payload?.items?.length) writes.push(prepared.write('feature-news.json', featureNews.payload))
  if (writes.length) await Promise.allSettled(writes)
}

async function publishPreparedHistory() {
  const payload = await history.read({ days: 8, resolutionMinutes: 1 })
  await prepared.write('market-history.json', compactHistoryForBrowser(payload))
}

async function refreshPreparedNews() {
  const payload = await featureNews.get()
  if (payload?.items?.length) await prepared.write('feature-news.json', payload)
}

async function refreshPrimaryMarket() {
  if (manualRefreshPromise) return manualRefreshPromise
  const startedAt = Date.now()
  manualRefreshPromise = collector.refresh()
    .then(async (snapshot) => {
      await history.maybeAppend(snapshot).catch(() => {})
      await publishPreparedFast().catch(() => {})
      await publishPreparedHistory().catch(() => {})
      return {
        ok: Boolean(snapshot?.ok),
        updatedAt: snapshot?.updatedAt ?? null,
        elapsedMs: Date.now() - startedAt,
        snapshot,
      }
    })
    .finally(() => { manualRefreshPromise = null })
  return manualRefreshPromise
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  if (request.method === 'OPTIONS') return send(response, 204, null)

  if (url.pathname === '/api/health') {
    return send(response, 200, {
      ok: true,
      configured: client.configured,
      marketReady: Boolean(collector.snapshot?.ok),
      marketMode: collector.snapshot?.mode ?? null,
      themeFlowReady: Boolean(themeFlow.payload?.ok),
      usThemeFlowReady: Boolean(usThemeFlow.payload?.ok),
      preparedSnapshotsEnabled: true,
      lastError: collector.lastError,
      themeFlowError: themeFlow.payload?.error ?? null,
      usThemeFlowError: usThemeFlow.payload?.error ?? null,
      usThemeRankingSource: usThemeFlow.payload?.rankingSource ?? null,
      usThemeRankingAttempts: usThemeFlow.payload?.rankingAttempts ?? [],
      updatedAt: collector.snapshot?.updatedAt ?? null,
      historyEnabled: true,
      startupSnapshotEnabled: true,
      themeHistoryPersisted: true,
      usThemeHistoryPersisted: true,
      quizUniverseCached: true,
      quizDescriptionsCached: true,
      featureNewsEnabled: true,
      refreshPolicy: {
        primaryMarketSeconds: 60,
        slowMarketSeconds: 180,
        featureNewsSeconds: 180,
        themeChartSeconds: 60,
        preparedPublishSeconds: 2,
        offSessionSeconds: 300,
      },
      requestScheduler: client.schedulerStats(),
      startupPriority: ['domestic-primary', 'domestic-theme', 'us-theme'],
    })
  }

  if (url.pathname === '/api/market/snapshot') {
    if (!collector.snapshot) return send(response, 503, { ok: false, error: '시장 데이터 초기화 중입니다.' })
    return send(response, 200, collector.snapshot)
  }

  if (url.pathname === '/api/market/refresh' && request.method === 'POST') {
    try {
      const result = await refreshPrimaryMarket()
      return send(response, result.ok ? 200 : 503, {
        ok: result.ok,
        updatedAt: result.updatedAt,
        elapsedMs: result.elapsedMs,
        note: '기존 화면을 유지한 채 첫 화면 핵심 데이터를 우선 갱신했습니다. 나머지 상세 데이터는 분산 수집 큐에서 계속 갱신됩니다.',
      })
    } catch (error) {
      return send(response, 503, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  if (url.pathname === '/api/market/theme-flow') {
    return send(response, themeFlow.payload?.ok ? 200 : 503, themeFlow.payload)
  }

  if (url.pathname === '/api/market/us-theme-flow') {
    return send(response, usThemeFlow.payload?.ok ? 200 : 503, usThemeFlow.payload)
  }

  if (url.pathname === '/api/market/feature-news') {
    const payload = await featureNews.get()
    if (payload?.items?.length) await prepared.write('feature-news.json', payload).catch(() => {})
    return send(response, payload.ok ? 200 : 503, payload)
  }

  if (url.pathname === '/api/quiz/universe') {
    const payload = await quizUniverse.get()
    return send(response, payload.ok ? 200 : 503, payload)
  }

  if (url.pathname === '/api/quiz/descriptions') {
    const codes = String(url.searchParams.get('codes') || '').split(',').map((value) => value.trim()).filter(Boolean)
    if (!codes.length) return send(response, 400, { ok: false, error: 'codes 파라미터가 필요합니다.', items: [] })
    const payload = await quizDescriptions.getMany(codes)
    return send(response, payload.ok ? 200 : 503, payload)
  }

  if (url.pathname === '/api/market/history') {
    const days = Math.max(1, Math.min(35, Number(url.searchParams.get('days') || 5)))
    const resolutionMinutes = Math.max(1, Math.min(30, Number(url.searchParams.get('resolution') || 5)))
    const payload = await history.read({ days, resolutionMinutes })
    return send(response, 200, payload)
  }

  if (url.pathname === '/api/market/funding') {
    return send(response, 200, fundingStatus())
  }

  return send(response, 404, { error: 'not-found' })
})

function send(response, status, payload) {
  response.statusCode = status
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Cache-Control', 'no-store')
  if (payload == null) return response.end()
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

server.listen(port, '0.0.0.0', () => {
  console.log(`[market-backend] listening on :${port}`)

  // Keep a last-known-good response available before any user arrives. Nginx serves
  // these prepared JSON files directly, so a page view never starts data collection.
  void history.latest({ maxAgeHours: 36 })
    .then(async (cached) => {
      if (cached && !collector.snapshot) {
        collector.snapshot = {
          ...cached,
          ok: false,
          mode: 'startup-cache',
          error: '마지막 저장값 표시 중 · 최신 시장 데이터 우선 갱신 중',
        }
        await publishPreparedFast().catch(() => {})
      }
      await publishPreparedHistory().catch(() => {})
      return collector.start()
    })
    .then(async () => {
      await history.maybeAppend(collector.snapshot).catch(() => {})
      await publishPreparedFast().catch(() => {})
      await publishPreparedHistory().catch(() => {})
    })
    .then(() => {
      krThemeStartTimer = setTimeout(() => {
        void themeFlow.start()
          .then(() => publishPreparedFast())
          .catch((error) => console.error('[market-backend] KR theme initialization failed', error))
      }, Number(process.env.KR_THEME_START_DELAY_MS || 3000))
      krThemeStartTimer.unref?.()

      usThemeStartTimer = setTimeout(() => {
        void usThemeFlow.start()
          .then(() => publishPreparedFast())
          .catch((error) => console.error('[market-backend] US initialization failed', error))
      }, Number(process.env.US_THEME_START_DELAY_MS || 8000))
      usThemeStartTimer.unref?.()

      newsTimer = setTimeout(() => {
        void refreshPreparedNews().catch((error) => console.error('[market-backend] news initialization failed', error))
      }, Number(process.env.FEATURE_NEWS_START_DELAY_MS || 12000))
      newsTimer.unref?.()
    })
    .catch((error) => console.error('[market-backend] KR initialization failed', error))

  preparedTimer = setInterval(() => publishPreparedFast().catch(() => {}), 2000)
  preparedTimer.unref?.()

  historyTimer = setInterval(() => history.maybeAppend(collector.snapshot).catch(() => {}), 60000)
  historyTimer.unref?.()

  preparedHistoryTimer = setInterval(() => publishPreparedHistory().catch(() => {}), 60000)
  preparedHistoryTimer.unref?.()

  const newsRefreshMs = Math.max(180000, Number(process.env.FEATURE_NEWS_REFRESH_MS || 180000))
  const recurringNewsTimer = setInterval(() => refreshPreparedNews().catch(() => {}), newsRefreshMs)
  recurringNewsTimer.unref?.()
  newsTimer = newsTimer || recurringNewsTimer
})

const shutdown = () => {
  collector.stop()
  themeFlow.stop()
  usThemeFlow.stop()
  if (historyTimer) clearInterval(historyTimer)
  if (preparedTimer) clearInterval(preparedTimer)
  if (preparedHistoryTimer) clearInterval(preparedHistoryTimer)
  if (newsTimer) clearTimeout(newsTimer)
  if (krThemeStartTimer) clearTimeout(krThemeStartTimer)
  if (usThemeStartTimer) clearTimeout(usThemeStartTimer)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
