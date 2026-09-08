import fs from 'node:fs/promises'

const KRX_JSON_URL = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd'
const KRX_BUSINESS_DAY_URL = 'https://data.krx.co.kr/comm/bldAttendant/executeForResourceBundle.cmd'
const KRX_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Referer: 'https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd',
  Origin: 'https://data.krx.co.kr',
}

const INDEXES = {
  kospi200: { code: '1028', label: 'KOSPI 200', expected: 200 },
  kosdaq150: { code: '2203', label: 'KOSDAQ 150', expected: 150 },
}

const EXCHANGE_TRADED_PRODUCT = /(ETF|ETN|KODEX|TIGER|RISE|ACE|PLUS|SOL|HANARO|KOSEF|TIMEFOLIO|ARIRANG|FOCUS|KBSTAR)/i

export function splitIndexCode(code) {
  return { indIdx: String(code)[0], indIdx2: String(code).slice(1) }
}

export function filterStockRows(rows = []) {
  const seen = new Set()
  return rows
    .map((row) => ({
      code: String(row?.ISU_SRT_CD ?? row?.code ?? '').trim(),
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

async function latestBusinessDay() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).replaceAll('-', '')
  const params = new URLSearchParams({ baseName: 'krx.mdc.i18n.component', key: 'B161.bld', inDate: today })
  const response = await fetch(`${KRX_BUSINESS_DAY_URL}?${params}`, { headers: KRX_HEADERS, signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`KRX 영업일 조회 실패 (${response.status})`)
  const payload = await response.json()
  const value = payload?.result?.output?.[0]?.bis_work_dt
  return /^\d{8}$/.test(String(value)) ? String(value) : today
}

async function fetchIndexMembers(code, date, expected) {
  const { indIdx, indIdx2 } = splitIndexCode(code)
  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT00601',
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
  if (!response.ok) throw new Error(`KRX 지수 구성종목 조회 실패 (${response.status})`)
  const payload = await response.json()
  const rows = capIndexMembers(filterStockRows(payload?.output ?? payload?.block1 ?? []), expected)
  if (rows.length < 50) throw new Error(`${code} 구성종목 응답이 비정상적으로 적습니다 (${rows.length})`)
  return rows
}

export class QuizUniverseService {
  constructor({ cachePath = '/app/data/quiz-universe.json', refreshMs = 6 * 60 * 60 * 1000 } = {}) {
    this.cachePath = cachePath
    this.refreshMs = refreshMs
    this.payload = null
    this.loading = null
  }

  async get() {
    if (this.payload && Date.now() - Date.parse(this.payload.updatedAt ?? 0) < this.refreshMs) return this.payload
    if (this.loading) return this.loading
    this.loading = this.refresh().finally(() => { this.loading = null })
    return this.loading
  }

  async refresh() {
    let cached = null
    try {
      cached = JSON.parse(await fs.readFile(this.cachePath, 'utf8'))
    } catch { /* first run */ }

    try {
      const date = await latestBusinessDay()
      const [kospi200, kosdaq150] = await Promise.all([
        fetchIndexMembers(INDEXES.kospi200.code, date, INDEXES.kospi200.expected),
        fetchIndexMembers(INDEXES.kosdaq150.code, date, INDEXES.kosdaq150.expected),
      ])
      const payload = {
        ok: true,
        source: 'KRX Data Marketplace · 지수구성종목',
        sourceDate: date,
        updatedAt: new Date().toISOString(),
        etfExcluded: true,
        expectedCounts: { kospi200: INDEXES.kospi200.expected, kosdaq150: INDEXES.kosdaq150.expected },
        kospi200,
        kosdaq150,
        counts: { kospi200: kospi200.length, kosdaq150: kosdaq150.length },
      }
      this.payload = payload
      await fs.mkdir(this.cachePath.split('/').slice(0, -1).join('/') || '.', { recursive: true })
      await fs.writeFile(this.cachePath, JSON.stringify(payload), 'utf8')
      return payload
    } catch (error) {
      if (cached?.kospi200?.length && cached?.kosdaq150?.length) {
        const kospi200 = capIndexMembers(filterStockRows(cached.kospi200), INDEXES.kospi200.expected)
        const kosdaq150 = capIndexMembers(filterStockRows(cached.kosdaq150), INDEXES.kosdaq150.expected)
        this.payload = {
          ...cached,
          ok: true,
          stale: true,
          etfExcluded: true,
          kospi200,
          kosdaq150,
          counts: { kospi200: kospi200.length, kosdaq150: kosdaq150.length },
          error: error instanceof Error ? error.message : String(error),
        }
        return this.payload
      }
      this.payload = {
        ok: false,
        source: 'KRX Data Marketplace · 지수구성종목',
        updatedAt: new Date().toISOString(),
        etfExcluded: true,
        expectedCounts: { kospi200: INDEXES.kospi200.expected, kosdaq150: INDEXES.kosdaq150.expected },
        kospi200: [],
        kosdaq150: [],
        counts: { kospi200: 0, kosdaq150: 0 },
        error: error instanceof Error ? error.message : String(error),
      }
      return this.payload
    }
  }
}
