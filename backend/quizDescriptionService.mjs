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

export class QuizDescriptionService {
  constructor({
    cachePath = '/app/data/quiz-descriptions.json',
    refreshMs = 14 * 24 * 60 * 60 * 1000,
    fetchTimeoutMs = 6500,
  } = {}) {
    this.cachePath = cachePath
    this.refreshMs = refreshMs
    this.fetchTimeoutMs = fetchTimeoutMs
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
  }

  async load() {
    if (this.loaded) return
    if (this.loading) return this.loading
    this.loading = (async () => {
      try {
        const saved = JSON.parse(await fs.readFile(this.cachePath, 'utf8'))
        for (const [code, item] of Object.entries(saved?.items ?? {})) {
          if (validCode(code) && item?.description) this.cache.set(code, item)
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
      refreshDays: Math.round(this.refreshMs / 86400000),
    }
  }

  async fetchOne(code) {
    const response = await fetch(`${NAVER_COMPANY_URL}${encodeURIComponent(code)}`, {
      headers: DEFAULT_HEADERS,
      signal: AbortSignal.timeout(this.fetchTimeoutMs),
    })
    if (!response.ok) throw new Error(`기업개요 조회 실패 (${response.status})`)
    const html = await decodeResponse(response)
    const description = extractCompanyOverview(html)
    if (!description) throw new Error('기업개요 본문을 찾지 못했습니다.')
    const item = {
      code,
      description,
      source: 'Npay 증권 기업개요 · FnGuide',
      sourceUrl: `${NAVER_COMPANY_URL}${code}`,
      fetchedAt: new Date().toISOString(),
    }
    this.cache.set(code, item)
    return item
  }

  async persist() {
    await fs.mkdir(this.cachePath.split('/').slice(0, -1).join('/') || '.', { recursive: true })
    const payload = {
      version: 2,
      savedAt: new Date().toISOString(),
      items: Object.fromEntries(this.cache.entries()),
    }
    const temp = `${this.cachePath}.tmp`
    await fs.writeFile(temp, JSON.stringify(payload), 'utf8')
    await fs.rename(temp, this.cachePath)
  }

  async getCachedMany(codes = []) {
    await this.load()
    const unique = [...new Set(codes.map(String).filter(validCode))].slice(0, 12)
    const items = unique.map((code) => {
      const cached = this.cache.get(code)
      if (cached?.description) return { ...cached, stale: !this.isFresh(cached) }
      return {
        code,
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
          results.set(code, { code, description: null, source: 'Npay 증권 기업개요 · FnGuide', sourceUrl: `${NAVER_COMPANY_URL}${code}`, stale: false, error: error instanceof Error ? error.message : String(error) })
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
      items,
    }
  }

  async prewarm(codes = [], { concurrency = 2, pauseMs = 180 } = {}) {
    await this.load()
    const unique = [...new Set(codes.map(String).filter(validCode))]
    if (!unique.length) return this.status([])
    if (this.warming) return this.warming

    this.warmState = {
      running: true,
      targetCount: unique.length,
      readyCount: 0,
      freshCount: 0,
      attempted: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }
    this.refreshWarmCounts(unique)

    this.warming = (async () => {
      const pending = unique.filter((code) => !this.isFresh(this.cache.get(code)))
      let changedSincePersist = 0

      await mapLimit(pending, Math.max(1, Math.min(4, Number(concurrency) || 2)), async (code) => {
        this.warmState.attempted += 1
        try {
          await this.fetchOne(code)
          changedSincePersist += 1
          if (changedSincePersist >= 20) {
            changedSincePersist = 0
            await this.persist().catch(() => {})
          }
        } catch {
          this.warmState.failed += 1
        }
        this.refreshWarmCounts(unique)
        if (pauseMs > 0) await sleep(pauseMs)
      })

      if (changedSincePersist > 0) await this.persist().catch(() => {})
      this.refreshWarmCounts(unique)
      this.warmState.running = false
      this.warmState.finishedAt = new Date().toISOString()
      return this.status(unique)
    })().finally(() => { this.warming = null })

    return this.warming
  }
}
