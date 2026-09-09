import http from 'node:http'
import { manualThemeStore, ThemeStoreError } from './manualThemeStore.mjs'

const port = Number(process.env.PORT || 8787)
const allowedOrigin = String(process.env.MARKET_ALLOWED_ORIGIN || '').trim()
const writeToken = String(process.env.THEME_ADMIN_WRITE_TOKEN || '').trim()
const MAX_BODY_BYTES = 32 * 1024

function send(response, status, payload) {
  response.statusCode = status
  if (allowedOrigin) response.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Theme-Admin-Token')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Cache-Control', 'no-store')
  if (payload == null) return response.end()
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new ThemeStoreError('요청 본문이 너무 큽니다.', 413)
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ThemeStoreError('올바른 JSON 요청이 필요합니다.')
  }
}

function assertWriteAccess(request) {
  if (!writeToken) return
  const received = String(request.headers['x-theme-admin-token'] || '').trim()
  if (received !== writeToken) throw new ThemeStoreError('테마 관리 쓰기 권한이 없습니다.', 401)
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  if (request.method === 'OPTIONS') return send(response, 204, null)

  if (url.pathname === '/api/health') {
    return send(response, 200, {
      ok: true,
      service: 'theme-admin',
      updatedAt: manualThemeStore.snapshot().updatedAt,
      writeProtected: Boolean(writeToken),
    })
  }

  if (url.pathname !== '/api/market/theme-admin') {
    return send(response, 404, { ok: false, error: 'not-found' })
  }

  if (request.method === 'GET') {
    return send(response, 200, {
      ...manualThemeStore.snapshot(),
      writeProtected: Boolean(writeToken),
    })
  }

  if (request.method !== 'POST') {
    return send(response, 405, { ok: false, error: '지원하지 않는 요청 방식입니다.' })
  }

  try {
    assertWriteAccess(request)
    const body = await readJsonBody(request)
    let operation = null

    if (body.action === 'create-theme') {
      operation = await manualThemeStore.createTheme(body.name)
    } else if (body.action === 'rename-theme') {
      operation = await manualThemeStore.renameTheme(body.fromName, body.toName)
    } else if (body.action === 'delete-theme') {
      operation = await manualThemeStore.deleteTheme(body.name)
    } else if (body.action === 'assign-stock') {
      operation = await manualThemeStore.assignStock(body.symbol, body.themes)
    } else {
      throw new ThemeStoreError('지원하지 않는 테마 관리 작업입니다.')
    }

    return send(response, 200, {
      ...manualThemeStore.snapshot(),
      writeProtected: Boolean(writeToken),
      operation,
    })
  } catch (error) {
    const status = error instanceof ThemeStoreError ? error.status : 500
    return send(response, status, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`[theme-admin] listening on :${port}`)
})

const shutdown = () => server.close(() => process.exit(0))
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
