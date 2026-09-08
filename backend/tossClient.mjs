const BASE_URL = 'https://openapi.tossinvest.com'

export class TossApiError extends Error {
  constructor(message, status, code = null) {
    super(message)
    this.name = 'TossApiError'
    this.status = status
    this.code = code
  }
}

export class TossClient {
  constructor({ clientId, clientSecret }) {
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.token = null
    this.tokenExpiresAt = 0
    this.tokenPromise = null
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret)
  }

  async getToken() {
    if (!this.configured) throw new TossApiError('TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 환경변수가 없습니다.', 500, 'credentials-missing')
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token
    if (this.tokenPromise) return this.tokenPromise

    this.tokenPromise = this.issueToken()
    try {
      return await this.tokenPromise
    } finally {
      this.tokenPromise = null
    }
  }

  async issueToken() {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret })
    const response = await fetch(`${BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    })
    const payload = await safeJson(response)
    if (!response.ok) {
      throw new TossApiError(payload?.error_description || payload?.error?.message || `토큰 발급 실패 (${response.status})`, response.status, payload?.error || payload?.error?.code)
    }
    this.token = payload.access_token
    this.tokenExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000
    return this.token
  }

  async request(path, attempt = 0) {
    const token = await this.getToken()
    const response = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    const payload = await safeJson(response)

    if (response.ok) return payload
    const code = payload?.error?.code || payload?.error || null
    const message = payload?.error?.message || payload?.error_description || `토스 API 오류 (${response.status})`

    if (response.status === 401 && attempt < 1) {
      this.token = null
      this.tokenExpiresAt = 0
      return this.request(path, attempt + 1)
    }
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get('retry-after') || 1)
      await sleep(Math.min(4000, Math.max(500, retryAfter * 1000 + Math.random() * 250)))
      return this.request(path, attempt + 1)
    }
    throw new TossApiError(message, response.status, code)
  }
}

async function safeJson(response) {
  try { return await response.json() } catch { return null }
}

export function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
