import fs from 'node:fs/promises'

const NAVER_COMPANY_URL = 'https://finance.naver.com/item/coinfo.naver?code='
const NAVER_MAIN_URL = 'https://finance.naver.com/item/main.naver?code='
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152 Safari/537.36',
  Referer: 'https://finance.naver.com/',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.4',
  'Cache-Control': 'no-cache',
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

  // Npay Finance can contain "실시간 기업개요" before the real section heading.
  // Walk occurrences from the end so the actual heading immediately preceding
  // FnGuide's overview body wins instead of returning "기업개요 동사는...".
  const starts = [...text.matchAll(/기업개요/g)].map((match) => match.index ?? -1).filter((index) => index >= 0).reverse()
  for (const start of starts) {
    const after = text.slice(start + '기업개요'.length)
    const sourceMatch = after.match(/출처\s*:\s*에프앤가이드/i)
    if (!sourceMatch) continue
    const section = after.slice(0, sourceMatch.index)
      .replace(/^\s+/, '')
      .replace(/^기업개요\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (section.length < 20) continue
    const sentences = section
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 12)
    const concise = (sentences.length ? sentences.slice(0, 3).join(' ') : section).trim()
    if (concise.length >= 20) return concise.slice(0, 700)
  }
  return null
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

function candidateCodes(code) {
  const result = [code]
  // Korean preferred-share issue codes normally reuse the first five digits of
  // the common share and use a non-zero final digit. If the direct issue page
  // has no overview, using the common-share overview is materially better than
  // showing a meaningless "KOSPI 거래대금 상위 종목" placeholder.
  if (validCode(code) && !code.endsWith('0')) {
    const commonCode = `${code.slice(0, 5)}0`
    if (commonCode !== code) result.push(commonCode)
  }
  return result
}

export class QuizDescriptionService {
  constructor({
    cachePath = '/app/data/quiz-descriptions.json',
    universeCachePath = '/app/data/quiz-universe.json',
    preparedPath = '/app/public-data/quiz-prepared.json',
    refreshMs = 14 * 24 * 60 * 60 * 1000,
    fetchTimeoutMs = 9000,
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
      void this.bootstrapPrewarm({ retries: this.bootstrapMaxAttempts, retryMs: this.bootstrapRetryMs }).catch(() => {})
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
        // First run or damaged cache: the prewarmer rebuilds it.
      }
      this.loaded = true
    })().finally(() => { this.loading = null })
    return this.loading
  }

  isFresh(item) {
    return Boolean(item?.description && Date.now() - Date.parse(item.fetchedAt ?? 0) < this.refreshMs)
  }

  async readUniverse() {
    try {
      const payload = JSON.parse(await fs.readFile(this.universeCachePath, 'utf8'))
      const normalize = (items, pool) => (items ?? [])
        .map((item) => normalizeTarget({ code: item?.code, name: item?.name, pool }))
        .filter(Boolean)
      const kospi200 = normalize(payload?.kospi200, 'kospi200').slice(0, 200)
      const kosdaq150 = normalize(payload?.kosdaq150, 'kosdaq150').slice(0, 150)
      const targets = uniqueTargets([
        ...kospi200.slice(0, 30),
        ...kosdaq150.slice(0, 30),
        ...kospi200.slice(30),
        ...kosdaq150.slice(30),
      ])
      return { payload, kospi200, kosdaq150, targets }
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

  refreshWarmCounts(targetCodes = []) {
    const targets = targetCodes.length ? new Set(targetCodes) : null
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
    this.refreshWarmCounts(targetCodes)
    return {
      ...this.warmState,
      targetCount: targetCodes.length || this.warmState.targetCount || this.cache.size,
      refreshDays: Math.round(this.refreshMs / 86400000),
    }
  }

  async fetchOverview(code) {
    const urls = [`${NAVER_COMPANY_URL}${encodeURIComponent(code)}`, `${NAVER_MAIN_URL}${encodeURIComponent(code)}`]
    let lastError = null

    for (const url of urls) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(url, {
            headers: DEFAULT_HEADERS,
            signal: AbortSignal.timeout(this.fetchTimeoutMs),
            redirect: 'follow',
          })
          if (!response.ok) {
            const error = new Error(`기업개요 조회 실패 (${response.status})`)
            error.status = response.status
            throw error
          }
          const html = await decodeResponse(response)
          const description = extractCompanyOverview(html)
          if (description) return { description, sourceUrl: url, sourceCode: code }
          lastError = new Error('기업개요 본문을 찾지 못했습니다.')
          break
        } catch (error) {
          lastError = error
          const status = Number(error?.status ?? 0)
          const retryable = status === 429 || status >= 500 || status === 0
          if (!retryable || attempt >= 2) break
          await sleep(350 * (attempt + 1))
        }
      }
    }
    throw lastError ?? new Error('기업개요를 조회하지 못했습니다.')
  }

  async fetchOne(value) {
    const target = normalizeTarget(value)
    if (!target) throw new Error('올바른 종목코드가 필요합니다.')

    let overview = null
    let lastError = null
    for (const sourceCode of candidateCodes(target.code)) {
      try {
        overview = await this.fetchOverview(sourceCode)
        break
      } catch (error) {
        lastError = error
      }
    }
    if (!overview) throw lastError ?? new Error('기업개요 본문을 찾지 못했습니다.')

    const previous = this.cache.get(target.code)
    const item = {
      code: target.code,
      name: target.name ?? previous?.name ?? null,
      pool: target.pool ?? previous?.pool ?? null,
      description: overview.description,
      source: 'Npay 증권 기업개요 · FnGuide',
      sourceUrl: overview.sourceUrl,
      sourceCode: overview.sourceCode,
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
    this.refreshWarmCounts(targetCodes)
    return {
      ok: true,
      source: 'Raspberry Pi 완성 퀴즈 캐시 · KRX 종목명 + Npay 증권 기업개요',
      sourceDate: universe.payload?.sourceDate ?? null,
      generatedAt: new Date().toISOString(),
      stale: Boolean(universe.payload?.stale),
      etfExcluded: true,
      kospi200,
      kosdaq150,
      counts: { kospi200: kospi200.length, kosdaq150: kosdaq150.length, ready: kospi200.length + kosdaq150.length },
      expectedCounts: { kospi200: 200, kosdaq150: 150, total: 350 },
      cacheStatus: this.status(targetCodes),
      error: universe.payload?.error ?? null,
    }
  }

  async publishPrepared(universeOverride = null) {
    await this.load()
    const universe = universeOverride ?? await this.readUniverse()
    this.enrichCachedMetadata(universe.targets)
    const payload = this.buildPreparedPayload(universe)
    await fs.mkdir(this.preparedPath.split('/').slice(0, -1).join('/') || '.', { recursive: true })
    const temp = `${this.preparedPath}.tmp`
    await fs.writeFile(temp, JSON.stringify(payload), 'utf8')
    await fs.rename(temp, this.preparedPath)
    return payload
  }

  async persist({ publish = true } = {}) {
    await fs.mkdir(this.cachePath.split('/').slice(0, -1).join('/') || '.', { recursive: true })
    const payload = {
      version: 4,
      savedAt: new Date().toISOString(),
      items: Object.fromEntries(this.cache.entries()),
    }
    const temp = `${this.cachePath}.tmp`
    await fs.writeFile(temp, JSON.stringify(payload), 'utf8')
    await fs.rename(temp, this.cachePath)
    if (publish) await this.publishPrepared().catch(() => {})
  }

  async getMany(values = []) {
    await this.load()
    const targets = uniqueTargets(values).slice(0, 12)
    const results = new Map()
    let changed = false

    // Npay Finance throttles bursts much more aggressively than Toss. Two
    // workers plus a short per-request pause fills TOP100 reliably on a Pi
    // instead of getting a few successes followed by a wall of 429 responses.
    await mapLimit(targets, 2, async (target) => {
      const cached = this.cache.get(target.code)
      if (this.isFresh(cached)) {
        results.set(target.code, { ...cached, stale: false })
        return
      }
      try {
        const item = await this.fetchOne(target)
        results.set(target.code, { ...item, stale: false })
        changed = true
      } catch (error) {
        if (cached?.description) {
          results.set(target.code, { ...cached, stale: true, error: error instanceof Error ? error.message : String(error) })
        } else {
          results.set(target.code, { code: target.code, name: target.name, description: null, source: 'Npay 증권 기업개요 · FnGuide', sourceUrl: `${NAVER_COMPANY_URL}${target.code}`, stale: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
      await sleep(180)
    })

    if (changed) await this.persist({ publish: false }).catch(() => {})
    const items = targets.map((target) => results.get(target.code)).filter(Boolean)
    const descriptionCount = items.filter((item) => item.description).length
    return {
      ok: descriptionCount > 0,
      complete: descriptionCount === items.length,
      descriptionCount,
      requestedCount: items.length,
      source: 'Npay 증권 기업개요 · FnGuide',
      updatedAt: new Date().toISOString(),
      items,
    }
  }

  async prewarm(values = [], { concurrency = 2, pauseMs = 220 } = {}) {
    await this.load()
    const targets = uniqueTargets(values)
    if (!targets.length) return this.status([])
    if (this.warming) return this.warming

    this.enrichCachedMetadata(targets)
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
    await this.persist().catch(() => {})

    this.warming = (async () => {
      const pending = targets.filter((target) => !this.isFresh(this.cache.get(target.code)))
      let changedSincePersist = 0

      await mapLimit(pending, Math.max(1, Math.min(3, Number(concurrency) || 2)), async (target) => {
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

  async bootstrapPrewarm({ retries = 20, retryMs = 15000 } = {}) {
    const attempts = Math.max(0, Number(retries) || 0)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const universe = await this.readUniverse()
      if (universe.targets.length >= 4) return this.prewarm(universe.targets)
      if (attempt < attempts - 1) await sleep(retryMs)
    }
    return this.status([])
  }
}
