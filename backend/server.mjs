import http from 'node:http'
import { MarketCollector } from './marketCollector.mjs'
import { SnapshotStore } from './snapshotStore.mjs'
import { PreparedSnapshotStore, compactHistoryForBrowser } from './preparedSnapshotStore.mjs'
import { ThemeFlowServiceFive } from './themeFlowServiceFive.mjs'
import { buildLiveThemePayload } from './themeLiveView.mjs'
import { UsThemeFlowService } from './usThemeFlowService.mjs'
import { QuizUniverseService } from './quizUniverseService.mjs'
import { QuizDescriptionService } from './quizDescriptionService.mjs'
import { FeatureNewsTodayService } from './featureNewsTodayService.mjs'
import { DailyIssueService } from './dailyIssueService.mjs'
import { TossClient } from './tossClient.mjs'
import { MarketIntelligenceService, buildEventTimeline, buildReplay, gradeNewsPayload } from './marketIntelligenceService.mjs'
import { FuturesProvider } from './futuresProvider.mjs'
import { CloseArchiveService } from './closeArchiveService.mjs'

const port = Number(process.env.PORT || 8787)
const primaryRefreshMs = Math.max(5000, Number(process.env.MARKET_PRIMARY_REFRESH_MS || process.env.POLL_MS || 10000))
const manualRefreshCooldownMs = Math.max(10000, Number(process.env.MANUAL_REFRESH_COOLDOWN_MS || 20000))
const allowedOrigin = String(process.env.MARKET_ALLOWED_ORIGIN || '').trim()
const client = new TossClient({
  clientId: process.env.TOSS_CLIENT_ID,
  clientSecret: process.env.TOSS_CLIENT_SECRET,
})
const collector = new MarketCollector(client, {
  fastMs: primaryRefreshMs,
  slowMs: Number(process.env.SLOW_POLL_MS || 180000),
})
const history = new SnapshotStore()
const prepared = new PreparedSnapshotStore()
const themeFlow = new ThemeFlowServiceFive(client, () => collector.snapshot, {
  refreshMs: Number(process.env.THEME_FLOW_REFRESH_MS || 60000),
  cachePath: process.env.THEME_CANDLE_CACHE_PATH || '/app/data/theme-candles.json',
})
const usThemeFlow = new UsThemeFlowService(client, {
  refreshMs: Number(process.env.US_THEME_FLOW_REFRESH_MS || 60000),
  cachePath: process.env.US_THEME_CANDLE_CACHE_PATH || '/app/data/us-theme-candles.json',
})
const quizUniverse = new QuizUniverseService({ cachePath: process.env.QUIZ_UNIVERSE_CACHE_PATH || '/app/data/quiz-universe.json' })
const quizDescriptions = new QuizDescriptionService({ cachePath: process.env.QUIZ_DESCRIPTION_CACHE_PATH || '/app/data/quiz-descriptions.json' })
const featureNews = new FeatureNewsTodayService({
  refreshMs: Number(process.env.FEATURE_NEWS_REFRESH_MS || 180000),
  getSnapshot: () => collector.snapshot,
  getThemes: () => themeFlow.payload?.themes ?? [],
})
const dailyIssues = new DailyIssueService(client, {
  cachePath: process.env.DAILY_ISSUE_CACHE_PATH || '/app/data/daily-issues.json',
})
const futuresProvider = new FuturesProvider()
const intelligence = new MarketIntelligenceService({
  themeCount: 5,
  replacementMargin: Number(process.env.THEME_REPLACEMENT_MARGIN || 0.08),
  replacementConfirmations: Number(process.env.THEME_REPLACEMENT_CONFIRMATIONS || 3),
})
const closeArchive = new CloseArchiveService(
  () => liveMarketSnapshot(),
  () => liveKrThemePayload(),
  { cachePath: process.env.CLOSE_ARCHIVE_CACHE_PATH || '/app/data/close-archive.json' },
)
let historyTimer = null
let preparedTimer = null
let preparedHistoryTimer = null
let newsStartTimer = null
let newsRefreshTimer = null
let krThemeStartTimer = null
let usThemeStartTimer = null
let futuresTimer = null
let manualRefreshPromise = null
let lastManualRefreshAt = 0
let latestHistoryPayload = { days: 8, tradingDays: 0, samples: [] }
let cachedIntelligence = null
let cachedIntelligenceKey = ''

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

function liveMarketSnapshot() {
  if (!collector.snapshot) return null
  const futures = futuresProvider.current()
  return {
    ...collector.snapshot,
    futures: futures.available ? futures : (collector.snapshot.futures ?? futures),
  }
}

function rawKrThemePayload() {
  return buildLiveThemePayload(themeFlow.payload, liveMarketSnapshot())
}

function currentIntelligence() {
  const snapshot = liveMarketSnapshot()
  const rawTheme = rawKrThemePayload()
  if (!snapshot) {
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      themes: [],
      quality: { level: 'critical', issues: [{ severity: 'critical', code: 'no-snapshot', message: '시장 스냅샷 초기화 중입니다.' }] },
    }
  }
  const historyUpdatedAt = latestHistoryPayload?.samples?.at(-1)?.updatedAt ?? ''
  const key = [snapshot.updatedAt, rawTheme?.sourceUpdatedAt, featureNews.payload?.updatedAt, futuresProvider.current()?.updatedAt, historyUpdatedAt].join('|')
  if (cachedIntelligence && cachedIntelligenceKey === key) return cachedIntelligence
  cachedIntelligence = intelligence.build({
    snapshot,
    themePayload: rawTheme,
    history: latestHistoryPayload,
    featureNews: featureNews.payload,
    futures: futuresProvider.current(),
  })
  cachedIntelligenceKey = key
  return cachedIntelligence
}

function liveKrThemePayload() {
  const raw = rawKrThemePayload()
  if (!raw?.ok) return raw
  const intel = currentIntelligence()
  return {
    ...raw,
    themes: intel.themes ?? raw.themes ?? [],
    criteria: { ...(raw.criteria ?? {}), themeCount: 5, hysteresis: '8%-or-3-confirmations', overlapAdjustment: '1/N' },
    intelligence: {
      market: intel.market ?? null,
      quality: intel.quality ?? null,
      freshness: intel.freshness ?? null,
      rules: intel.rules ?? null,
    },
  }
}

async function publishPreparedFast() {
  const writes = []
  const snapshot = liveMarketSnapshot()
  if (snapshot) writes.push(prepared.write('market-snapshot.json', snapshot))
  const krThemePayload = liveKrThemePayload()
  if (krThemePayload?.ok) writes.push(prepared.write('kr-theme-flow.json', krThemePayload))
  const intelligencePayload = currentIntelligence()
  if (intelligencePayload?.ok) writes.push(prepared.write('market-intelligence.json', intelligencePayload))
  if (usThemeFlow.payload?.ok) writes.push(prepared.write('us-theme-flow.json', usThemeFlow.payload))
  if (featureNews.payload?.ok) writes.push(prepared.write('feature-news.json', gradeNewsPayload(featureNews.payload)))
  if (writes.length) await Promise.allSettled(writes)
}

async function publishPreparedHistory() {
  const payload = await history.read({ days: 8, resolutionMinutes: 1 })
  latestHistoryPayload = payload
  cachedIntelligenceKey = ''
  await prepared.write('market-history.json', compactHistoryForBrowser(payload))
}

async function refreshPreparedNews() {
  const payload = await featureNews.get()
  cachedIntelligenceKey = ''
  if (payload?.ok) await prepared.write('feature-news.json', gradeNewsPayload(payload))
}

async function refreshPrimaryMarket() {
  if (manualRefreshPromise) return manualRefreshPromise
  const startedAt = Date.now()
  manualRefreshPromise = Promise.all([
    collector.refresh(),
    futuresProvider.get().catch(() => futuresProvider.current()),
  ])
    .then(async ([snapshot]) => {
      cachedIntelligenceKey = ''
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
    const dailyIssueState = dailyIssues.currentPayload()
    const intelligenceState = currentIntelligence()
    const futuresState = futuresProvider.current()
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
      dailyIssuesEnabled: true,
      closeArchiveEnabled: true,
      marketIntelligenceEnabled: true,
      marketIntelligenceQuality: intelligenceState?.quality?.level ?? null,
      futuresConfigured: futuresState.configured,
      futuresAvailable: futuresState.available,
      futuresSource: futuresState.source,
      dailyIssuesStatus: dailyIssueState.status ?? null,
      dailyIssuesDate: dailyIssueState.date ?? null,
      refreshPolicy: {
        primaryMarketSeconds: Math.round(primaryRefreshMs / 1000),
        slowMarketSeconds: Math.round(collector.slowMs / 1000),
        featureNewsSeconds: Math.round(Number(process.env.FEATURE_NEWS_REFRESH_MS || 180000) / 1000),
        featureNewsWindow: '06:00-today-rescan-and-accumulate',
        themeChartLiveSeconds: Math.round(primaryRefreshMs / 1000),
        themeCandleCollectionSeconds: Math.round(themeFlow.refreshMs / 1000),
        themeCount: 5,
        themeWeighting: '3m-trading-amount-weighted-return',
        themeReplacement: '8%-or-3-confirmations',
        dailyIssueFinalizeKst: '15:20',
        closeArchiveKst: ['15:20', '15:35'],
        preparedPublishSeconds: 2,
        manualRefreshCooldownSeconds: Math.round(manualRefreshCooldownMs / 1000),
        offSessionSeconds: 300,
      },
      requestScheduler: client.schedulerStats(),
      startupPriority: ['domestic-primary', 'domestic-theme', 'us-theme'],
    })
  }

  if (url.pathname === '/api/market/snapshot') {
    const snapshot = liveMarketSnapshot()
    if (!snapshot) return send(response, 503, { ok: false, error: '시장 데이터 초기화 중입니다.' })
    return send(response, 200, snapshot)
  }

  if (url.pathname === '/api/market/refresh' && request.method === 'POST') {
    const elapsed = Date.now() - lastManualRefreshAt
    if (!manualRefreshPromise && elapsed < manualRefreshCooldownMs) {
      return send(response, 429, {
        ok: false,
        error: '수동 새로고침 쿨다운 중입니다.',
        retryAfterSeconds: Math.ceil((manualRefreshCooldownMs - elapsed) / 1000),
      })
    }
    lastManualRefreshAt = Date.now()
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
    const payload = liveKrThemePayload()
    return send(response, payload?.ok ? 200 : 503, payload)
  }

  if (url.pathname === '/api/market/intelligence') {
    const payload = currentIntelligence()
    return send(response, payload?.ok ? 200 : 503, payload)
  }

  if (url.pathname === '/api/market/event-timeline') {
    const symbol = String(url.searchParams.get('symbol') || '').trim()
    if (!/^\d{6}$/.test(symbol)) return send(response, 400, { ok: false, error: '올바른 국내 종목코드가 필요합니다.', events: [] })
    const snapshot = liveMarketSnapshot()
    const stock = (snapshot?.topRankings ?? []).find((item) => item.symbol === symbol)
      ?? Object.values(snapshot?.stocks ?? {}).find((item) => item?.symbol === symbol)
      ?? (liveKrThemePayload()?.themes ?? []).flatMap((theme) => theme.members ?? []).find((item) => item.symbol === symbol)
      ?? { symbol, name: url.searchParams.get('name') || symbol }
    const chart = await themeFlow.stockChartReady(symbol, { fallbackName: stock?.name ?? symbol }).catch(() => themeFlow.stockChart(symbol))
    const news = gradeNewsPayload(await featureNews.get().catch(() => featureNews.payload))
    return send(response, 200, buildEventTimeline({ stock, chart, news }))
  }

  if (url.pathname === '/api/market/theme-stock-chart') {
    const symbol = String(url.searchParams.get('symbol') || '').trim()
    const fallbackName = String(url.searchParams.get('name') || '').trim() || null
    const payload = await themeFlow.stockChartReady(symbol, { fallbackName })
    return send(response, payload.ok ? 200 : 404, payload)
  }

  if (url.pathname === '/api/market/us-theme-flow') {
    return send(response, usThemeFlow.payload?.ok ? 200 : 503, usThemeFlow.payload)
  }

  if (url.pathname === '/api/market/feature-news') {
    const payload = gradeNewsPayload(await featureNews.get())
    cachedIntelligenceKey = ''
    if (payload?.ok) await prepared.write('feature-news.json', payload).catch(() => {})
    return send(response, payload.ok ? 200 : 503, payload)
  }

  if (url.pathname === '/api/market/daily-issues') {
    const payload = await dailyIssues.get()
    return send(response, 200, payload)
  }

  if (url.pathname === '/api/market/close-archive') {
    await closeArchive.check().catch(() => {})
    return send(response, 200, closeArchive.current())
  }

  if (url.pathname === '/api/market/replay') {
    const days = Math.max(1, Math.min(35, Number(url.searchParams.get('days') || 2)))
    const resolutionMinutes = Math.max(1, Math.min(30, Number(url.searchParams.get('resolution') || 5)))
    const payload = await history.read({ days, resolutionMinutes })
    return send(response, 200, { ...buildReplay(payload), closeArchive: closeArchive.current().records })
  }

  if (url.pathname === '/api/market/futures') {
    const payload = await futuresProvider.get()
    cachedIntelligenceKey = ''
    return send(response, 200, payload)
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
  if (allowedOrigin) response.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Cache-Control', 'no-store')
  if (payload == null) return response.end()
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

server.listen(port, '0.0.0.0', () => {
  console.log(`[market-backend] listening on :${port}`)

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
      await futuresProvider.get().catch(() => {})
      await history.maybeAppend(collector.snapshot).catch(() => {})
      await publishPreparedFast().catch(() => {})
      await publishPreparedHistory().catch(() => {})
      void dailyIssues.start().catch((error) => console.error('[market-backend] daily issues initialization failed', error))
      void closeArchive.start().catch((error) => console.error('[market-backend] close archive initialization failed', error))
    })
    .then(() => {
      krThemeStartTimer = setTimeout(() => {
        void themeFlow.start()
          .then(() => { cachedIntelligenceKey = ''; return publishPreparedFast() })
          .catch((error) => console.error('[market-backend] KR theme initialization failed', error))
      }, Number(process.env.KR_THEME_START_DELAY_MS || 3000))
      krThemeStartTimer.unref?.()

      usThemeStartTimer = setTimeout(() => {
        void usThemeFlow.start()
          .then(() => publishPreparedFast())
          .catch((error) => console.error('[market-backend] US initialization failed', error))
      }, Number(process.env.US_THEME_START_DELAY_MS || 8000))
      usThemeStartTimer.unref?.()

      newsStartTimer = setTimeout(() => {
        void refreshPreparedNews().catch((error) => console.error('[market-backend] news initialization failed', error))
      }, Number(process.env.FEATURE_NEWS_START_DELAY_MS || 12000))
      newsStartTimer.unref?.()
    })
    .catch((error) => console.error('[market-backend] KR initialization failed', error))

  preparedTimer = setInterval(() => publishPreparedFast().catch(() => {}), 2000)
  preparedTimer.unref?.()

  historyTimer = setInterval(() => history.maybeAppend(liveMarketSnapshot()).catch(() => {}), 60000)
  historyTimer.unref?.()

  preparedHistoryTimer = setInterval(() => publishPreparedHistory().catch(() => {}), 60000)
  preparedHistoryTimer.unref?.()

  const newsRefreshMs = Math.max(180000, Number(process.env.FEATURE_NEWS_REFRESH_MS || 180000))
  newsRefreshTimer = setInterval(() => refreshPreparedNews().catch(() => {}), newsRefreshMs)
  newsRefreshTimer.unref?.()

  futuresTimer = setInterval(() => {
    void futuresProvider.get().then(() => { cachedIntelligenceKey = '' }).catch(() => {})
  }, futuresProvider.refreshMs)
  futuresTimer.unref?.()
})

const shutdown = () => {
  collector.stop()
  themeFlow.stop()
  usThemeFlow.stop()
  dailyIssues.stop()
  closeArchive.stop()
  if (historyTimer) clearInterval(historyTimer)
  if (preparedTimer) clearInterval(preparedTimer)
  if (preparedHistoryTimer) clearInterval(preparedHistoryTimer)
  if (newsStartTimer) clearTimeout(newsStartTimer)
  if (newsRefreshTimer) clearInterval(newsRefreshTimer)
  if (krThemeStartTimer) clearTimeout(krThemeStartTimer)
  if (usThemeStartTimer) clearTimeout(usThemeStartTimer)
  if (futuresTimer) clearInterval(futuresTimer)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
