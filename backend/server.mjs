import http from 'node:http'
import { MarketCollector } from './marketCollector.mjs'
import { SnapshotStore } from './snapshotStore.mjs'
import { ThemeFlowService } from './themeFlowService.mjs'
import { TossClient } from './tossClient.mjs'

const port = Number(process.env.PORT || 8787)
const client = new TossClient({
  clientId: process.env.TOSS_CLIENT_ID,
  clientSecret: process.env.TOSS_CLIENT_SECRET,
})
const collector = new MarketCollector(client, {
  fastMs: Number(process.env.POLL_MS || 60000),
  slowMs: Number(process.env.SLOW_POLL_MS || 60000),
})
const history = new SnapshotStore()
const themeFlow = new ThemeFlowService(client, () => collector.snapshot, {
  refreshMs: Number(process.env.THEME_FLOW_REFRESH_MS || 60000),
  cachePath: process.env.THEME_CANDLE_CACHE_PATH || '/app/data/theme-candles.json',
})
let historyTimer = null

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

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  if (request.method === 'OPTIONS') return send(response, 204, null)

  if (url.pathname === '/api/health') {
    return send(response, 200, {
      ok: true,
      configured: client.configured,
      marketReady: Boolean(collector.snapshot?.ok),
      themeFlowReady: Boolean(themeFlow.payload?.ok),
      lastError: collector.lastError,
      themeFlowError: themeFlow.payload?.error ?? null,
      updatedAt: collector.snapshot?.updatedAt ?? null,
      historyEnabled: true,
      themeHistoryPersisted: true,
      refreshSeconds: 60,
    })
  }

  if (url.pathname === '/api/market/snapshot') {
    if (!collector.snapshot) return send(response, 503, { ok: false, error: '시장 데이터 초기화 중입니다.' })
    return send(response, 200, collector.snapshot)
  }

  if (url.pathname === '/api/market/theme-flow') {
    return send(response, themeFlow.payload?.ok ? 200 : 503, themeFlow.payload)
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
  response.setHeader('Cache-Control', 'no-store')
  if (payload == null) return response.end()
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

server.listen(port, '0.0.0.0', async () => {
  console.log(`[market-backend] listening on :${port}`)
  await collector.start()
  await history.maybeAppend(collector.snapshot).catch(() => {})
  void themeFlow.start()
  historyTimer = setInterval(() => history.maybeAppend(collector.snapshot).catch(() => {}), 60000)
  historyTimer.unref?.()
})

const shutdown = () => {
  collector.stop()
  themeFlow.stop()
  if (historyTimer) clearInterval(historyTimer)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
