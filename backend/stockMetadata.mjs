function stockRecords(payload) {
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
  constructor({ ttlMs = 6 * 60 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs
    this.items = new Map()
    this.updatedAt = 0
  }

  get(symbol) {
    return this.items.get(String(symbol ?? '').trim()) ?? null
  }

  async ensure(client, symbols = []) {
    const unique = [...new Set(symbols.map((symbol) => String(symbol ?? '').trim()).filter(Boolean))]
    if (!unique.length) return this.items
    const missing = unique.filter((symbol) => !this.items.has(symbol))
    if (!missing.length && Date.now() - this.updatedAt < this.ttlMs) return this.items

    for (let index = 0; index < unique.length; index += 100) {
      const chunk = unique.slice(index, index + 100)
      const payload = await client.request(`/api/v1/stocks?symbols=${encodeURIComponent(chunk.join(','))}`)
      for (const record of stockRecords(payload)) {
        const meta = stockMeta(record)
        if (meta.symbol) this.items.set(meta.symbol, meta)
      }
    }
    this.updatedAt = Date.now()
    return this.items
  }
}
