import http from 'node:http'
import { MarketCollector } from './marketCollector.mjs'
import { TossClient } from './tossClient.mjs'

const port = Number(process.env.PORT || 8787)
const client = new TossClient({
  clientId: process.env.TOSS_CLIENT_ID,
  clientSecret: process.env.TOSS_CLIENT_SECRET,
})
const collector = new MarketCollector(client, {
  fastMs: Number(process.env.POLL_MS || 5000),
  slowMs: Number(process.env.SLOW_POLL_MS || 60000),
})

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  if (request.method === 'OPTIONS') return send(response, 204, null)

  if (url.pathname === '/api/health') {
    return send(response, 200, {
      ok: true,
      configured: client.configured,
      marketReady: Boolean(collector.snapshot?.ok),
      lastError: collector.lastError,
      updatedAt: collector.snapshot?.updatedAt ?? null,
    })
  }

  if (url.pathname === '/api/market/snapshot') {
    if (!collector.snapshot) return send(response, 503, { ok: false, error: '시장 데이터 초기화 중입니다.' })
    return send(response, 200, collector.snapshot)
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
})

const shutdown = () => {
  collector.stop()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
