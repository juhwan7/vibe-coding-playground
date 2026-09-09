import fs from 'node:fs/promises'

const KRX_JSON_URL = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd'
const KRX_BUSINESS_DAY_URL = 'https://data.krx.co.kr/comm/bldAttendant/executeForResourceBundle.cmd'
export const KRX_INDEX_CONSTITUENTS_BLD = 'dbms/MDC/STAT/standard/MDCSTAT00701'
const KRX_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Referer: 'https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd',
  Origin: 'https://data.krx.co.kr',
}

const TOSS_WTS_COMPOSITION_URL = (code) => `https://wts-info-api.tossinvest.com/api/v2/stock-infos/A${code}/compositions`
const TOSS_WTS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Origin: 'https://tossinvest.com',
  Referer: 'https://tossinvest.com/',
  Accept: 'application/json',
}

const WEB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.4',
  'Cache-Control': 'no-cache',
}

const RISE_INDEX_PAGES = {
  kospi200: 'https://www.riseetf.co.kr/prod/finderDetail/4435?searchFlag=viewtab3',
  kosdaq150: 'https://www.riseetf.co.kr/prod/finderDetail/4459?searchFlag=viewtab3',
}
const NAVER_KOSPI200_URL = (page) => `https://finance.naver.com/sise/entryJongmok.naver?indCode=KPI200&page=${page}`

const INDEXES = {
  kospi200: { code: '1028', label: 'KOSPI 200', expected: 200, proxyEtfCode: '069500', proxyEtfName: 'KODEX 200' },
  kosdaq150: { code: '2203', label: 'KOSDAQ 150', expected: 150, proxyEtfCode: '229200', proxyEtfName: 'KODEX 코스닥150' },
}

const EXCHANGE_TRADED_PRODUCT = /(ETF|ETN|KODEX|TIGER|RISE|ACE|PLUS|SOL|HANARO|KOSEF|TIMEFOLIO|ARIRANG|FOCUS|KBSTAR)/i

function kstDateKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).replaceAll('-', '')
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

function htmlCellText(value) {
  return decodeEntities(String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

async function decodeHtmlResponse(response) {
  const bytes = new Uint8Array(await response.arrayBuffer())
  const contentType = response.headers.get('content-type') ?? ''
  const declared = contentType.match(/charset\s*=\s*([^;\s]+)/i)?.[1]?.replace(/["']/g, '').toLowerCase()
  for (const charset of [...new Set([declared, 'utf-8', 'euc-kr'].filter(Boolean))]) {
    try { return new TextDecoder(charset).decode(bytes) } catch {}
  }
  return new TextDecoder().decode(bytes)
}

export function splitIndexCode(code) {
  return { indIdx: String(code)[0], indIdx2: String(code).slice(1) }
}

export function filterStockRows(rows = []) {
  const seen = new Set()
  return rows
    .map((row) => ({
      code: String(row?.ISU_SRT_CD ?? row?.code ?? '').trim().replace(/^A(?=\d{6}$)/, ''),
      name: String(row?.ISU_ABBRV ?? row?.name ?? '').trim(),
    }))
    .filter((row) => /^\d{6}$/.test(row.code) && row.name && !EXCHANGE_TRADED_PRODUCT.test(row.name))
    .filter((row) => {
      if (seen.has(row.code)) return false
      seen.add(row.code)
      return true
    })
}

export function capIndexMembers(rows = [], expected) {
  const limit = Number(expected)
  if (!Number.isFinite(limit) || limit <= 0) return [...rows]
  return rows.slice(0, Math.floor(limit))
}

export function parseTossEtfComposition(payload, expected) {
  const rows = (payload?.result?.items ?? []).map((item) => ({
    code: typeof item?.stockCode === 'string' ? item.stockCode.replace(/^A(?=\d{6}$)/, '') : '',
    name: String(item?.name ?? '').trim(),
  }))
  return capIndexMembers(filterStockRows(rows), expected)
}

export function parseRiseEtfHoldings(html, expected) {
  const rows = []
  for (const match of String(html ?? '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = match[1]
    const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => htmlCellText(cell[1]))
    const isinIndex = cells.findIndex((cell) => /^KR7\d{9}$/.test(cell.replace(/\s+/g, '')))
    if (isinIndex < 1) continue
    const isin = cells[isinIndex].replace(/\s+/g, '')
    rows.push({ code: isin.slice(3, 9), name: cells[isinIndex - 1] })
  }
  return capIndexMembers(filterStockRows(rows), expected)
}

export function parseNaverIndexMembers(html, expected) {
  const rows = []
  const pattern = /item\/main\.naver\?code=(\d{6})[^>]*>([\s\S]*?)<\/a>/gi
  for (const match of String(html ?? '').matchAll(pattern)) {
    rows.push({ code: match[1], name: htmlCellText(match[2]) })
  }
  return capIndexMembers(filterStockRows(rows), expected)
}

function assertUsableMembers(rows, index, source) {
  const minimum = Math.max(4, index.expected - 8)
  if (rows.length < minimum) throw new Error(`${source} ${index.label} 구성종목 응답이 비정상적으로 적습니다 (${rows.length})`)
  return rows
}

async function latestBusinessDay() {
  const today = kstDateKey()
  const params = new URLSearchParams({ baseName: 'krx.mdc.i18n.component', key: 'B161.bld', inDate: today })
  const response = await fetch(`${KRX_BUSINESS_DAY_URL}?${params}`, { headers: KRX_HEADERS, signal: AbortSignal.timeout(8000) })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`KRX 영업일 조회 실패 (${response.status}${body ? ` · ${body.slice(0, 80)}` : ''})`)
  }
  const payload = await response.json()
  const value = payload?.result?.output?.[0]?.bis_work_dt
  return /^\d{8}$/.test(String(value)) ? String(value) : today
}

async function fetchIndexMembers(code, date, expected) {
  const { indIdx, indIdx2 } = splitIndexCode(code)
  const body = new URLSearchParams({
    bld: KRX_INDEX_CONSTITUENTS_BLD,
    indIdx,
    indIdx2,
    param1indIdx_finder_equidx0_1: '',
    trdDd: date,
    money: '1',
    csvxls_isNo: 'false',
  })
  const response = await fetch(KRX_JSON_URL, {
    method: 'POST',
    headers: { ...KRX_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body,
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) {
    const responseBody = await response.text().catch(() => '')
    throw new Error(`KRX 지수 구성종목 조회 실패 (${response.status}${responseBody ? ` · ${responseBody.slice(0, 80)}` : ''})`)
  }
  const payload = await response.json()
  const rows = capIndexMembers(filterStockRows(payload?.output ?? payload?.block1 ?? []), expected)
  if (rows.length < 50) throw new Error(`${code} 구성종목 응답이 비정상적으로 적습니다 (${rows.length})`)
  return rows
}

async function fetchRiseIndexMembers(pool) {
  const index = INDEXES[pool]
  const url = RISE_INDEX_PAGES[pool]
  const response = await fetch(url, {
    headers: { ...WEB_HEADERS, Referer: 'https://www.riseetf.co.kr/' },
    signal: AbortSignal.timeout(12000),
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`RISE ${index.label} 구성종목 조회 실패 (${response.status})`)
  const html = await decodeHtmlResponse(response)
  const rows = parseRiseEtfHoldings(html, index.expected)
  return assertUsableMembers(rows, index, 'RISE ETF')
}

async function fetchNaverKospi200() {
  const index = INDEXES.kospi200
  const merged = []
  for (let page = 1; page <= 24; page += 1) {
    const response = await fetch(NAVER_KOSPI200_URL(page), {
      headers: { ...WEB_HEADERS, Referer: 'https://finance.naver.com/' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    })
    if (!response.ok) throw new Error(`Npay 증권 KOSPI 200 구성종목 조회 실패 (${response.status})`)
    const html = await decodeHtmlResponse(response)
    const pageRows = parseNaverIndexMembers(html, index.expected)
    if (!pageRows.length) break
    merged.push(...pageRows)
    if (filterStockRows(merged).length >= index.expected) break
  }
  return assertUsableMembers(capIndexMembers(filterStockRows(merged), index.expected), index, 'Npay 증권')
}

async function fetchProxyEtfMembers(index) {
  const response = await fetch(TOSS_WTS_COMPOSITION_URL(index.proxyEtfCode), {
    headers: TOSS_WTS_HEADERS,
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error(`${index.proxyEtfName} 구성종목 조회 실패 (${response.status})`)
  const payload = await response.json()
  const rows = parseTossEtfComposition(payload, index.expected)
  if (rows.length < 50) throw new Error(`${index.proxyEtfName} 구성종목 응답이 비정상적으로 적습니다 (${rows.length})`)
  return rows
}

function normalizeCachedPayload(cached, stale = false, error = null) {
  if (!cached?.kospi200?.length || !cached?.kosdaq150?.length) return null
  const kospi200 = capIndexMembers(filterStockRows(cached.kospi200), INDEXES.kospi200.expected)
  const kosdaq150 = capIndexMembers(filterStockRows(cached.kosdaq150), INDEXES.kosdaq150.expected)
  if (kospi200.length < 4 || kosdaq150.length < 4) return null
  return {
    ...cached,
    ok: true,
    stale,
    etfExcluded: true,
    kospi200,
    kosdaq150,
    counts: { kospi200: kospi200.length, kosdaq150: kosdaq150.length },
    ...(error ? { error } : {}),
  }
}

export class QuizUniverseService {
  constructor({ cachePath = '/app/data/quiz-universe.json', refreshMs = 6 * 60 * 60 * 1000 } = {}) {
    this.cachePath = cachePath
    this.refreshMs = refreshMs
    this.payload = null
    this.loading = null
  }

  isFresh(payload) {
    const updatedAt = Date.parse(payload?.updatedAt ?? 0)
    return Number.isFinite(updatedAt) && Date.now() - updatedAt < this.refreshMs
  }

  async readCached() {
    try {
      const cached = JSON.parse(await fs.readFile(this.cachePath, 'utf8'))
      return normalizeCachedPayload(cached, !this.isFresh(cached))
    } catch {
      return null
    }
  }

  refreshInBackground(cached = this.payload) {
    if (this.loading) return this.loading
    this.loading = this.refresh(cached)
      .catch(() => this.payload)
      .finally(() => { this.loading = null })
    return this.loading
  }

  async get() {
    if (this.payload) {
      if (!this.isFresh(this.payload)) this.refreshInBackground(this.payload)
      return this.payload
    }

    const cached = await this.readCached()
    if (cached) {
      this.payload = cached
      if (!this.isFresh(cached)) this.refreshInBackground(cached)
      return cached
    }

    if (this.loading) return this.loading
    this.loading = this.refresh(null).finally(() => { this.loading = null })
    return this.loading
  }

  async persistPayload(payload) {
    this.payload = payload
    await fs.mkdir(this.cachePath.split('/').slice(0, -1).join('/') || '.', { recursive: true })
    await fs.writeFile(this.cachePath, JSON.stringify(payload), 'utf8')
    return payload
  }

  async refresh(cachedOverride = null) {
    const cached = cachedOverride ?? await this.readCached()
    const errors = []

    try {
      const date = await latestBusinessDay()
      const [kospi200, kosdaq150] = await Promise.all([
        fetchIndexMembers(INDEXES.kospi200.code, date, INDEXES.kospi200.expected),
        fetchIndexMembers(INDEXES.kosdaq150.code, date, INDEXES.kosdaq150.expected),
      ])
      return this.persistPayload({
        ok: true,
        source: 'KRX Data Marketplace · 지수구성종목',
        sourceDate: date,
        universeMode: 'krx-index-constituents',
        benchmarkProxy: false,
        updatedAt: new Date().toISOString(),
        stale: false,
        etfExcluded: true,
        expectedCounts: { kospi200: INDEXES.kospi200.expected, kosdaq150: INDEXES.kosdaq150.expected },
        kospi200,
        kosdaq150,
        counts: { kospi200: kospi200.length, kosdaq150: kosdaq150.length },
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }

    try {
      const [kospi200, kosdaq150] = await Promise.all([
        fetchRiseIndexMembers('kospi200'),
        fetchRiseIndexMembers('kosdaq150'),
      ])
      return this.persistPayload({
        ok: true,
        source: 'RISE ETF · KOSPI200 / KOSDAQ150 구성종목(PDF)',
        sourceDate: kstDateKey(),
        universeMode: 'official-benchmark-etf-holdings-fallback',
        benchmarkProxy: true,
        warning: `KRX 비로그인 조회가 불가해 동일 지수를 추종하는 공식 ETF 구성종목으로 자동 대체했습니다. ${errors[0]}`,
        updatedAt: new Date().toISOString(),
        stale: false,
        etfExcluded: true,
        expectedCounts: { kospi200: INDEXES.kospi200.expected, kosdaq150: INDEXES.kosdaq150.expected },
        kospi200,
        kosdaq150,
        counts: { kospi200: kospi200.length, kosdaq150: kosdaq150.length },
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }

    try {
      const [kospi200, kosdaq150] = await Promise.all([
        fetchNaverKospi200(),
        fetchRiseIndexMembers('kosdaq150'),
      ])
      return this.persistPayload({
        ok: true,
        source: 'Npay 증권 KOSPI200 + RISE ETF KOSDAQ150 구성종목',
        sourceDate: kstDateKey(),
        universeMode: 'mixed-public-web-fallback',
        benchmarkProxy: true,
        warning: `KRX와 RISE 동시 조회가 실패해 공개 구성종목 페이지를 조합했습니다. ${errors.join(' / ')}`,
        updatedAt: new Date().toISOString(),
        stale: false,
        etfExcluded: true,
        expectedCounts: { kospi200: INDEXES.kospi200.expected, kosdaq150: INDEXES.kosdaq150.expected },
        kospi200,
        kosdaq150,
        counts: { kospi200: kospi200.length, kosdaq150: kosdaq150.length },
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }

    // Keep the old Toss parser as a last diagnostic source. The current public
    // endpoint only exposes a TOP10 slice, so it must never replace a full index.
    try {
      await Promise.all([
        fetchProxyEtfMembers(INDEXES.kospi200),
        fetchProxyEtfMembers(INDEXES.kosdaq150),
      ])
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }

    const message = errors.filter(Boolean).join(' / ')
    const fallback = normalizeCachedPayload(cached, true, message)
    if (fallback) {
      this.payload = fallback
      return fallback
    }
    this.payload = {
      ok: false,
      source: 'KRX + 공식 지수추종 ETF 구성종목 fallback',
      updatedAt: new Date().toISOString(),
      stale: false,
      etfExcluded: true,
      expectedCounts: { kospi200: INDEXES.kospi200.expected, kosdaq150: INDEXES.kosdaq150.expected },
      kospi200: [],
      kosdaq150: [],
      counts: { kospi200: 0, kosdaq150: 0 },
      error: message,
    }
    return this.payload
  }
}
