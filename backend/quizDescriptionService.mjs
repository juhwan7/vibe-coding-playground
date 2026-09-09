import fs from 'node:fs/promises'

const NAVER_COMPANY_URL = 'https://finance.naver.com/item/coinfo.naver?code='
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Referer: 'https://finance.naver.com/',
  Accept: 'text/html,application/xhtml+xml',
}

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
}

function htmlToText(html) {
  return decodeEntities(String(html ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|li|div|dd|dt|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

export function extractCompanyOverview(html) {
  const text = htmlToText(html)
  if (!text) return null

  const start = text.indexOf('기업개요')
  if (start < 0) return null
  const after = text.slice(start + '기업개요'.length)
  const sourceMatch = after.match(/출처\s*:\s*에프앤가이드/i)
  const section = (sourceMatch ? after.slice(0, sourceMatch.index) : after.slice(0, 1800))
    .replace(/^\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (section.length < 20) return null

  const sentences = section
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12)
  const concise = (sentences.length ? sentences.slice(0, 2).join(' ') : section).trim()
  return concise.slice(0, 520)
}

function validCode(code) {
  return /^\d{6}$/.test(String(code ?? ''))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function decodeResponse(response) {
  const bytes = new Uint8Array(await response.arrayBuffer())
  const contentType = response.headers.get('content-type') ?? ''
  const declared = contentType.match(/charset\s*=\s*([^;\s]+)/i)?.[1]?.replace(/["']/g, '').toLowerCase()
  const candidates = [declared, 'euc-kr', 'utf-8'].filter(Boolean)
  for (const charset of [...new Set(candidates)]) {
    try {
      const text = new TextDecoder(charset).decode(bytes)
      if (text.includes('기업개요') || charset === candidates.at(-1)) return text
    } catch {
      // Try the next decoder supported by this Node build.
    }
  }
  return new TextDecoder().decode(bytes)
}

async function mapLimit(items, limit, worker) {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      if (item == null) return
      await worker(item)
    }
  })
  await Promise.all(workers)
}

function normalizeTarget(value) {
  if (typeof value === 'string') return validCode(value) ? { code: value, name: null, pool: null } : null
  const code = String(value?.code ?? '')
  if (!validCode(code)) return null
  return {
    code,
    name: String(value?.name ?? '').trim() || null,
    pool: value?.pool === 'kospi200' || value?.pool === 'kosdaq150' ? value.pool : null,
  }
}

function uniqueTargets(values = []) {
  const byCode = new Map()
  for (const value of values) {
    const target = normalizeTarget(value)
    if (!target) continue
    const previous = byCode.get(target.code)
    byCode.set(target.code, {
      code: target.code,
      name: target.name ?? previous?.name ?? null,
      pool: target.pool ?? previous?.pool ?? null,
    })
  }
  return [...byCode.values()]
}

export class QuizDescriptionService {
  constructor({
    cachePath = '/app/data/quiz-descriptions.json',
    universeCachePath = '/app/data/quiz-universe.json',
    preparedPath = '/app/public-data/quiz-prepared.json',
    refreshMs = 14 * 24 * 60 * 60 * 1000,
    fetchTimeoutMs = 6500,
    bootstrapDelayMs = 5000,
    bootstrapRetryMs = 15000,
    bootstrapMaxAttempts = 20,
  } = {}) {
    this.cachePath = cachePath
    this.universeCachePath = universeCachePath
    this.preparedPath = preparedPath
    this.refreshMs = refreshMs
    this.fetchTimeoutMs = fetchTimeoutMs
    this.bootstrapRetryMs = bootstrapRetryMs
    this.bootstrapMaxAttempts = bootstrapMaxAttempts
    this.cache = new Map()
    this.loaded = false
    this.loading = null
    this.warming = null
    this.warmState = {
      running: false,
      targetCount: 0,
      readyCount: 0,
      freshCount: 0,
      attempted: 0,
      failed: 0,
      startedAt: null,
      finishedAt: null,
    }

    this.bootstrapTimer = setTimeout(() => {
      void this.bootstrapPrewarm().catch(() => {})
    }, Math.max(0, Number(bootstrapDelayMs) || 0))
    this.bootstrapTimer.unref?.()
  }

  async load() {
    if (this.loaded) return
    if (this.loading) return this.loading
    this.loading = (async () => {
      try {
        const saved = JSON.parse(await fs.readFile(this.cachePath, 'utf8'))
        for (const [code, item] of Object.entries(saved?.items ?? {})) {
          if (validCode(code) && item?.description) this.cache.set(code, { ...item, code })
        }
      } catch {
        // First run or damaged cache: the background prewarmer rebuilds it.
      }
      this.loaded = true
      this.refreshWarmCounts()
    })().finally(() => { this.loading = null })
    return this.loading
  }

  isFresh(item) {
    return Boolean(item?.description && Date.now() - Date.parse(item.fetchedAt ?? 0) < this.refreshMs)
  }

  cachedCodes({ freshOnly = false } = {}) {
    return [...this.cache.entries()]
      .filter(([, item]) => item?.description && (!freshOnly || this.isFresh(item)))
      .map(([code]) => code)
  }

  refreshWarmCounts(targetCodes = null) {
    const targets = targetCodes ? new Set(targetCodes) : null
    let readyCount = 0
    let freshCount = 0
    for (const [code, item] of this.cache.entries()) {
      if (targets && !targets.has(code)) continue
      if (!item?.description) continue
      readyCount += 1
      if (this.isFresh(item)) freshCount += 1
    }
    this.warmState.readyCount = readyCount
    this.warmState.freshCount = freshCount
  }

  status(targetCodes = []) {
    const unique = [...new Set(targetCodes.map(String).filter(validCode))]
    this.refreshWarmCounts(unique.length ? unique : null)
    return {
      ...this.warmState,
      targetCount: unique.length || this.warmState.targetCount || this.cache.size,
      cachePath: this.cachePath,
      preparedPath: this.preparedPath,
      refreshDays: Math.round(this.refreshMs / 86400000),
    }
  }

  async readUniverse() {
    try {
      const payload = JSON.parse(await fs.readFile(this.universeCachePath, 'utf8'))
      const normalize = (items, pool) => (items ?? [])
        .map((item) => normalizeTarget({ code: item?.code, name: item?.name, pool }))
        .filter(Boolean)
      const kospi200 = normalize(payload?.kospi200, 'kospi200').slice(0, 200)
      const kosdaq150 = normalize(payload?.kosdaq150, 'kosdaq150').slice(0, 150)
      return {
        payload,
        kospi200,
        kosdaq150,
        targets: uniqueTargets([
          ...kospi200.slice(0, 30),
          ...kosdaq150.slice(0, 30),
          ...kospi200.slice(30),
          ...kosdaq150.slice(30),
        ]),
      }
    } catch {
      return { payload: null, kospi200: [], kosdaq150: [], targets: [] }
    }
  }

  enrichCachedMetadata(targets = []) {
    let changed = false
    for (const target of uniqueTargets(targets)) {
      const cached = this.cache.get(target.code)
      if (!cached?.description) continue
      const next = {
        ...cached,
        code: target.code,
        name: target.name ?? cached.name ?? null,
        pool: target.pool ?? cached.pool ?? null,
      }
      if (next.name !== cached.name || next.pool !== cached.pool) changed = true
      this.cache.set(target.code, next)
    }
    return changed
  }

  async bootstrapPrewarm() {
    for (let attempt = 0; attempt < this.bootstrapMaxAttempts; attempt += 1) {
      const universe = await this.readUniverse()
      if (universe.targets.length >= 4) return this.prewarm(universe.targets, { concurrency: 2, pauseMs: 180 })
      if (attempt < this.bootstrapMaxAttempts - 1) await sleep(this.bootstrapRetryMs)
    }
    return this.status([])
  }

  async fetchOne(value) {
    const target = normalizeTarget(value)
    if (!target) throw new Error('올바른 종목코드가 필요합니다.')
    const response = await fetch(`${NAVER_COMPANY_URL}${encodeURIComponent(target.code)}`, {
      headers: DEFAULT_HEADERS,
      signal: AbortSignal.timeout(this.fetchTimeoutMs),
    })
    if (!response.ok) throw new Error(`기업개요 조회 실패 (${response.status})`)
    const html = await decodeResponse(response)
    const description = extractCompanyOverview(html)
    if (!description) throw new Error('기업개요 본문을 찾지 못했습니다.')
    const previous = this.cache.get(target.code)
    const item = {
      code: target.code,
      name: target.name ?? previous?.name ?? null,
      pool: target.pool ?? previous?.pool ?? null,
      description,
      source: 'Npay 증권 기업개요 · FnGuide',
      sourceUrl: `${NAVER_COMPANY_URL}${target.code}`,
      fetchedAt: new Date().toISOString(),
    }
    this.cache.set(target.code, item)
    return item
  }

  buildPreparedPayload(universe) {
    const build = (members, pool) => members.flatMap((member) => {
      const cached = this.cache.get(member.code)
      if (!cached?.description) return []
      return [{
        code: member.code,
        name: member.name ?? cached.name ?? member.code,
        pool,
        description: cached.description,
        source: cached.source ?? 'Npay 증권 기업개요 · FnGuide',
        sourceUrl: cached.sourceUrl ?? `${NAVER_COMPANY_URL}${member.code}`,
        fetchedAt: cached.fetchedAt ?? null,
        stale: !this.isFresh(cached),
      }]
    })

    const kospi200 = build(universe.kospi200, 'kospi200')
    const kosdaq150 = build(universe.kosdaq150, 'kosdaq150')
    const targetCodes = universe.targets.map((item) => item.code)
    const cacheStatus = this.status(targetCodes)
    const ready = kospi200.length + kosdaq150.length
    return {
      ok: true,
      source: 'Raspberry Pi 완성 퀴즈 캐시 · KRX 종목명 + Npay 증권 기업개요',
      sourceDate: universe.payload?.sourceDate ?? null,
      generatedAt: new Date().toISOString(),
      stale: Boolean(universe.payload?.stale),
      etfExcluded: true,
      kospi200,
      kosdaq150,
      counts: { kospi200: kospi200.length, kosdaq150: kosdaq150.length, ready },
      expectedCounts: { kospi200: 200, kosdaq150: 150, total: 350 },
      cacheStatus,
      error: universe.payload?.error ?? null,
    }
  }

  async publishPrepared(universeOverride = null) {
    const universe = universeOverride ?? await this.readUniverse()
    this.enrichCachedMetadata(universe.targets)
    const payload = this.buildPreparedPayload(universe)
    await fs.mkdir(this.preparedPath.split('/').slice(0, -1).join('/') || '.', { recursive: true })
    const temp = `${this.preparedPath}.tmp`
    await fs.writeFile(temp, JSON.stringify(payload), 'utf8')
    await fs.rename(temp, this.preparedPath)
    return payload
  }

  async getPrepared() {
    await this.load()
    const universe = await this.readUniverse()
    this.enrichCachedMetadata(universe.targets)
    return this.publishPrepared(universe)
  }

  async persist({ publish = true } = {}) {
    await fs.mkdir(this.cachePath.split('/').slice(0, -1).join('/') || '.', { recursive: true })
    const payload = {
      version: 3,
      savedAt: new Date().toISOString(),
      items: Object.fromEntries(this.cache.entries()),
    }
    const temp = `${this.cachePath}.tmp`
    await fs.writeFile(temp, JSON.stringify(payload), 'utf8')
    await fs.rename(temp, this.cachePath)
    if (publish) await this.publishPrepared().catch(() => {})
  }

  async getCachedMany(codes = []) {
    await this.load()
    const unique = [...new Set(codes.map(String).filter(validCode))].slice(0, 12)
    const items = unique.map((code) => {
      const cached = this.cache.get(code)
      if (cached?.description) return { ...cached, stale: !this.isFresh(cached) }
      return {
        code,
        name: null,
        pool: null,
        description: null,
        source: 'Raspberry Pi 기업설명 캐시',
        sourceUrl: `${NAVER_COMPANY_URL}${code}`,
        stale: false,
        error: '기업설명 캐시 준비 중',
      }
    })
    return {
      ok: items.every((item) => item.description),
      cacheOnly: true,
      source: 'Raspberry Pi 영속 기업설명 캐시',
      updatedAt: new Date().toISOString(),
      readyCodes: this.cachedCodes(),
      cacheStatus: this.status(),
      items,
    }
  }

  async getMany(codes = [], { allowFetch = false } = {}) {
    if (!allowFetch) return this.getCachedMany(codes)
    await this.load()
    const unique = [...new Set(codes.map(String).filter(validCode))].slice(0, 12)
    const results = new Map()
    let changed = false

    await mapLimit(unique, 4, async (code) => {
      const cached = this.cache.get(code)
      if (this.isFresh(cached)) {
        results.set(code, { ...cached, stale: false })
        return
      }
      try {
        const item = await this.fetchOne(code)
        results.set(code, { ...item, stale: false })
        changed = true
      } catch (error) {
        if (cached?.description) {
          results.set(code, { ...cached, stale: true, error: error instanceof Error ? error.message : String(error) })
        } else {
          results.set(code, { code, name: null, pool: null, description: null, source: 'Npay 증권 기업개요 · FnGuide', sourceUrl: `${NAVER_COMPANY_URL}${code}`, stale: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
    })

    if (changed) await this.persist().catch(() => {})
    const items = unique.map((code) => results.get(code)).filter(Boolean)
    return {
      ok: items.some((item) => item.description),
      cacheOnly: false,
      source: 'Npay 증권 기업개요 · FnGuide',
      updatedAt: new Date().toISOString(),
      readyCodes: this.cachedCodes(),
      cacheStatus: this.status(),
      items,
    }
  }

  async prewarm(values = [], { concurrency = 2, pauseMs = 180 } = {}) {
    await this.load()
    const targets = uniqueTargets(values)
    if (!targets.length) return this.status([])
    if (this.warming) return this.warming

    this.enrichCachedMetadata(targets)
    await this.persist().catch(() => {})

    const targetCodes = targets.map((item) => item.code)
    this.warmState = {
      running: true,
      targetCount: targets.length,
      readyCount: 0,
      freshCount: 0,
      attempted: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }
    this.refreshWarmCounts(targetCodes)
    await this.publishPrepared().catch(() => {})

    this.warming = (async () => {
      const pending = targets.filter((target) => !this.isFresh(this.cache.get(target.code)))
      let changedSincePersist = 0

      await mapLimit(pending, Math.max(1, Math.min(4, Number(concurrency) || 2)), async (target) => {
        this.warmState.attempted += 1
        try {
          await this.fetchOne(target)
          changedSincePersist += 1
          if (changedSincePersist >= 10) {
            changedSincePersist = 0
            await this.persist().catch(() => {})
          }
        } catch {
          this.warmState.failed += 1
        }
        this.refreshWarmCounts(targetCodes)
        if (pauseMs > 0) await sleep(pauseMs)
      })

      if (changedSincePersist > 0) await this.persist().catch(() => {})
      this.refreshWarmCounts(targetCodes)
      this.warmState.running = false
      this.warmState.finishedAt = new Date().toISOString()
      await this.publishPrepared().catch(() => {})
      return this.status(targetCodes)
    })().finally(() => { this.warming = null })

    return this.warming
  }
}
