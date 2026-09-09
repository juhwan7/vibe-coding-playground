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
  constructor({ cachePath = '/app/data/quiz-descriptions.json', refreshMs = 14 * 24 * 60 * 60 * 1000 } = {}) {
    this.cachePath = cachePath
    this.refreshMs = refreshMs
    this.cache = new Map()
    this.loaded = false
    this.loading = null
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
        // First run or damaged cache: rebuild lazily from Naver Finance.
      }
      this.loaded = true
    })().finally(() => { this.loading = null })
    return this.loading
  }

  isFresh(item) {
    return Boolean(item?.description && Date.now() - Date.parse(item.fetchedAt ?? 0) < this.refreshMs)
  }

  async fetchOne(code) {
    const response = await fetch(`${NAVER_COMPANY_URL}${encodeURIComponent(code)}`, {
      headers: DEFAULT_HEADERS,
      signal: AbortSignal.timeout(10000),
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
      version: 1,
      savedAt: new Date().toISOString(),
      items: Object.fromEntries(this.cache.entries()),
    }
    const temp = `${this.cachePath}.tmp`
    await fs.writeFile(temp, JSON.stringify(payload), 'utf8')
    await fs.rename(temp, this.cachePath)
  }

  async getMany(codes = []) {
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
      source: 'Npay 증권 기업개요 · FnGuide',
      updatedAt: new Date().toISOString(),
      items,
    }
  }
}
