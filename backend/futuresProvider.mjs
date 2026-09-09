function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export class FuturesProvider {
  constructor({
    url = process.env.FUTURES_SNAPSHOT_URL || '',
    token = process.env.FUTURES_SNAPSHOT_TOKEN || '',
    refreshMs = Number(process.env.FUTURES_REFRESH_MS || 10000),
  } = {}) {
    this.url = String(url).trim()
    this.token = String(token).trim()
    this.refreshMs = Math.max(5000, Number(refreshMs) || 10000)
    this.payload = {
      available: false,
      configured: Boolean(this.url),
      source: null,
      updatedAt: null,
      priceChangeRate: null,
      tradingStrength: null,
      tradingVolume: null,
      openInterest: null,
      foreignNetContracts: null,
      institutionNetContracts: null,
      note: this.url
        ? '선물 데이터 공급원 응답을 기다리는 중입니다.'
        : '검증된 KOSPI200 선물 데이터 공급원을 FUTURES_SNAPSHOT_URL로 연결하면 활성화됩니다. 값을 임의 생성하지 않습니다.',
    }
    this.loading = null
    this.lastAttemptAt = 0
  }

  current() {
    return this.payload
  }

  async get() {
    if (!this.url) return this.payload
    if (Date.now() - this.lastAttemptAt < this.refreshMs && this.payload.updatedAt) return this.payload
    if (this.loading) return this.loading
    this.loading = this.refresh().finally(() => { this.loading = null })
    return this.loading
  }

  async refresh() {
    this.lastAttemptAt = Date.now()
    const headers = { Accept: 'application/json' }
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    try {
      const response = await fetch(this.url, { headers, signal: AbortSignal.timeout(7000) })
      if (!response.ok) throw new Error(`선물 데이터 공급원 HTTP ${response.status}`)
      const raw = await response.json()
      const source = raw?.source ?? raw?.provider ?? 'external-verified-provider'
      const updatedAt = raw?.updatedAt ?? raw?.timestamp ?? new Date().toISOString()
      const next = {
        available: true,
        configured: true,
        source,
        updatedAt,
        priceChangeRate: number(raw?.priceChangeRate),
        tradingStrength: number(raw?.tradingStrength),
        tradingVolume: number(raw?.tradingVolume),
        openInterest: number(raw?.openInterest),
        foreignNetContracts: number(raw?.foreignNetContracts),
        institutionNetContracts: number(raw?.institutionNetContracts),
        note: raw?.note ?? '외부 검증 공급원에서 받은 원시 값을 가공 없이 표시합니다.',
      }
      if (next.priceChangeRate == null && next.tradingVolume == null && next.openInterest == null) {
        throw new Error('선물 공급원 응답에 검증 가능한 핵심 값이 없습니다.')
      }
      this.payload = next
    } catch (error) {
      this.payload = {
        ...this.payload,
        available: false,
        configured: true,
        note: error instanceof Error ? error.message : String(error),
      }
    }
    return this.payload
  }
}
