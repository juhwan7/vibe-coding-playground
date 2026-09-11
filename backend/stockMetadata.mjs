export function stockRecords(payload) {
  const result = payload?.result
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.stocks)) return result.stocks
  if (Array.isArray(result?.items)) return result.items
  if (Array.isArray(result?.records)) return result.records
  return []
}

export function validStockName(name, symbol = null) {
  const value = String(name ?? '').trim()
  const normalizedSymbol = String(symbol ?? '').trim()
  if (!value || value === normalizedSymbol || /^\d{6}$/.test(value)) return null
  return value
}

export function stockMeta(item = {}) {
  const stock = item?.stock ?? {}
  const symbol = item?.symbol ?? stock?.symbol ?? null
  const rawNames = [
    item?.name, item?.stockName, item?.displayName, item?.shortName, item?.koreanName,
    stock?.name, stock?.stockName, stock?.displayName, stock?.shortName, stock?.koreanName,
  ]
  return {
    symbol,
    name: rawNames.map((name) => validStockName(name, symbol)).find(Boolean) ?? null,
    market: item?.market ?? item?.marketName ?? item?.exchange ?? stock?.market ?? stock?.marketName ?? null,
    securityType: item?.securityType ?? stock?.securityType ?? null,
    isCommonShare: item?.isCommonShare ?? stock?.isCommonShare ?? null,
    status: item?.status ?? stock?.status ?? null,
  }
}

export function directNameFromRanking(item = {}) {
  const symbol = item?.symbol ?? item?.stock?.symbol ?? null
  const candidates = [
    item?.name, item?.stockName, item?.displayName, item?.shortName, item?.koreanName,
    item?.stock?.name, item?.stock?.stockName, item?.stock?.displayName, item?.stock?.shortName, item?.stock?.koreanName,
  ]
  return candidates.map((name) => validStockName(name, symbol)).find(Boolean) ?? null
}

export class StockMetadataCache {
  constructor({ ttlMs = 6 * 60 * 60 * 1000, chunkSize = 10, unresolvedRetryMs = 60 * 1000 } = {}) {
    this.ttlMs = ttlMs
    this.chunkSize = chunkSize
    this.unresolvedRetryMs = unresolvedRetryMs
    this.items = new Map()
    this.updatedAt = 0
    this.lastAttemptAt = new Map()
  }

  get(symbol) {
    return this.items.get(String(symbol ?? '').trim()) ?? null
  }

  ingest(payload) {
    for (const record of stockRecords(payload)) {
      const meta = stockMeta(record)
      if (meta.symbol) this.items.set(meta.symbol, meta)
    }
  }

  unresolved(symbols = []) {
    return symbols.filter((symbol) => !validStockName(this.items.get(symbol)?.name, symbol))
  }

  async ensure(client, symbols = []) {
    const unique = [...new Set(symbols.map((symbol) => String(symbol ?? '').trim()).filter(Boolean))]
    if (!unique.length) return this.items

    const now = Date.now()
    const stale = now - this.updatedAt >= this.ttlMs
    const unresolved = new Set(this.unresolved(unique))
    const targets = unique.filter((symbol) => {
      if (!unresolved.has(symbol)) return stale
      return now - (this.lastAttemptAt.get(symbol) ?? 0) >= this.unresolvedRetryMs
    })
    if (!targets.length) return this.items

    for (const symbol of targets) this.lastAttemptAt.set(symbol, now)

    for (let index = 0; index < targets.length; index += this.chunkSize) {
      const chunk = targets.slice(index, index + this.chunkSize)
      try {
        const payload = await client.request(`/api/v1/stocks?symbols=${encodeURIComponent(chunk.join(','))}`)
        this.ingest(payload)
      } catch {
        // 개별 종목 재시도에서 복구한다.
      }
    }

    // 묶음 요청이 일부 종목을 누락하거나 이름 없이 반환하는 경우 개별 조회로 한 번 더 복구한다.
    for (const symbol of this.unresolved(targets)) {
      try {
        const payload = await client.request(`/api/v1/stocks?symbols=${encodeURIComponent(symbol)}`)
        this.ingest(payload)
      } catch {
        // 다음 unresolvedRetryMs 이후 다시 시도한다.
      }
    }

    this.updatedAt = now
    return this.items
  }
}
