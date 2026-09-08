const BASE_URL = 'https://openapi.tossinvest.com'

const PRIORITY_ORDER = ['critical', 'normal', 'background']

export class TossApiError extends Error {
  constructor(message, status, code = null) {
    super(message)
    this.name = 'TossApiError'
    this.status = status
    this.code = code
  }
}

export function priorityForPath(path = '') {
  if (path.includes('/rankings?') && path.includes('marketCountry=KR')) return 'critical'
  if (path.startsWith('/api/v1/market-indicators/prices')) return 'critical'
  if (path.startsWith('/api/v1/prices?')) return 'normal'
  if (path.includes('/rankings?') && path.includes('marketCountry=US')) return 'normal'
  if (path.includes('/candles?') || path.includes('/investor-trading') || path.includes('/program-trades') || path.startsWith('/api/v1/stocks?')) return 'background'
  return 'normal'
}

export class RequestScheduler {
  constructor({ maxConcurrent = 2, batchSize = 5, windowMs = 2000 } = {}) {
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || 2)
    this.batchSize = Math.max(1, Number(batchSize) || 5)
    this.windowMs = Math.max(100, Number(windowMs) || 2000)
    this.active = 0
    this.starts = []
    this.queues = { critical: [], normal: [], background: [] }
    this.timer = null
  }

  enqueue(task, { priority = 'normal' } = {}) {
    const normalized = PRIORITY_ORDER.includes(priority) ? priority : 'normal'
    return new Promise((resolve, reject) => {
      this.queues[normalized].push({ task, resolve, reject })
      this.pump()
    })
  }

  nextJob() {
    for (const priority of PRIORITY_ORDER) {
      const job = this.queues[priority].shift()
      if (job) return job
    }
    return null
  }

  cleanupStarts(now = Date.now()) {
    const threshold = now - this.windowMs
    this.starts = this.starts.filter((startedAt) => startedAt > threshold)
  }

  scheduleWake(delayMs) {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.pump()
    }, Math.max(5, delayMs))
    this.timer.unref?.()
  }

  pump() {
    const now = Date.now()
    this.cleanupStarts(now)

    if (this.active >= this.maxConcurrent) return
    if (this.starts.length >= this.batchSize) {
      const nextAt = this.starts[0] + this.windowMs
      this.scheduleWake(nextAt - now + 5)
      return
    }

    while (this.active < this.maxConcurrent && this.starts.length < this.batchSize) {
      const job = this.nextJob()
      if (!job) return
      this.active += 1
      this.starts.push(Date.now())
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1
          this.pump()
        })
    }

    if (this.starts.length >= this.batchSize) {
      const current = Date.now()
      this.cleanupStarts(current)
      if (this.starts.length >= this.batchSize) this.scheduleWake(this.starts[0] + this.windowMs - current + 5)
    }
  }

  stats() {
    return {
      active: this.active,
      queuedCritical: this.queues.critical.length,
      queuedNormal: this.queues.normal.length,
      queuedBackground: this.queues.background.length,
      maxConcurrent: this.maxConcurrent,
      batchSize: this.batchSize,
      windowMs: this.windowMs,
    }
  }
}

export class TossClient {
  constructor({ clientId, clientSecret, scheduler = null }) {
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.token = null
    this.tokenExpiresAt = 0
    this.tokenPromise = null
    this.scheduler = scheduler ?? new RequestScheduler({
      maxConcurrent: Number(process.env.TOSS_MAX_CONCURRENT || 2),
      batchSize: Number(process.env.TOSS_REQUEST_BATCH_SIZE || 5),
      windowMs: Number(process.env.TOSS_REQUEST_WINDOW_MS || 2000),
    })
    this.inFlight = new Map()
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

  request(path, { priority = priorityForPath(path), dedupe = true } = {}) {
    if (dedupe && this.inFlight.has(path)) return this.inFlight.get(path)

    const promise = this.scheduler.enqueue(() => this.performRequest(path, 0), { priority })
    if (dedupe) {
      this.inFlight.set(path, promise)
      promise.finally(() => {
        if (this.inFlight.get(path) === promise) this.inFlight.delete(path)
      }).catch(() => {})
    }
    return promise
  }

  async performRequest(path, attempt = 0) {
    const token = await this.getToken()
    const response = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    const payload = await safeJson(response)

    if (response.ok) return payload
    const code = payload?.error?.code || payload?.error || null
    const message = payload?.error?.message || payload?.error_description || `토스 API 오류 (${response.status})`

    if (response.status === 401 && attempt < 1) {
      this.token = null
      this.tokenExpiresAt = 0
      return this.performRequest(path, attempt + 1)
    }
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get('retry-after') || 1)
      const exponential = 500 * (2 ** attempt)
      await sleep(Math.min(5000, Math.max(exponential, retryAfter * 1000 + Math.random() * 250)))
      return this.performRequest(path, attempt + 1)
    }
    throw new TossApiError(message, response.status, code)
  }

  schedulerStats() {
    return this.scheduler.stats()
  }
}

async function safeJson(response) {
  try { return await response.json() } catch { return null }
}

export function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
