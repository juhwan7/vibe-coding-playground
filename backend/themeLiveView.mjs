import { themesForStock } from './themeCatalog.mjs'
import { cachedDescriptionForStock, classifyStockSector } from './stockClassification.mjs'

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function liveMap(snapshot) {
  return new Map((snapshot?.topRankings ?? []).filter((item) => item?.symbol).map((item) => [item.symbol, item]))
}

function validName(name, symbol) {
  const value = String(name ?? '').trim()
  return value && value !== String(symbol ?? '').trim() && !/^\d{6}$/.test(value) ? value : null
}

function mergeRanking(base, live) {
  if (!live) return base
  return {
    ...base,
    name: validName(live.name, live.symbol) ?? validName(base?.name, base?.symbol) ?? base?.name ?? live?.name ?? null,
    market: live.market ?? base?.market ?? null,
    securityType: live.securityType ?? base?.securityType ?? null,
    lastPrice: number(live.lastPrice) ?? base?.lastPrice ?? null,
    changeRate: number(live.changeRate) ?? base?.changeRate ?? null,
    tradingAmount: number(live.tradingAmount) ?? base?.tradingAmount ?? null,
    tradingVolume: number(live.tradingVolume) ?? base?.tradingVolume ?? null,
  }
}

function withCatalogThemes(item) {
  if (!item) return item
  const verifiedThemes = themesForStock(item.symbol, item.name)
  if (verifiedThemes.length) {
    return {
      ...item,
      catalogThemes: verifiedThemes,
      classificationLabel: verifiedThemes[0],
      classificationKind: 'theme',
      classificationSource: 'theme-catalog',
    }
  }

  const classification = classifyStockSector({
    symbol: item.symbol,
    name: item.name,
    description: cachedDescriptionForStock(item.symbol),
  })
  return {
    ...item,
    // 기존 프론트의 중립 배지 렌더링 경로를 그대로 재사용한다.
    // 실제 주도테마 선정에는 themeCatalog.mjs만 사용하므로 이 fallback은 테마 집계에 영향이 없다.
    catalogThemes: [classification.label],
    classificationLabel: classification.label,
    classificationKind: classification.label === '기타·개별주' ? 'fallback' : 'sector',
    classificationSource: classification.source,
  }
}

function weightedLiveDelta(entries) {
  if (!entries.length) return 0
  const positiveWeights = entries.filter((entry) => entry.weight > 0)
  const totalWeight = positiveWeights.reduce((sum, entry) => sum + entry.weight, 0)
  if (totalWeight > 0) return positiveWeights.reduce((sum, entry) => sum + entry.delta * entry.weight, 0) / totalWeight
  return entries.reduce((sum, entry) => sum + entry.delta, 0) / entries.length
}

export function buildLiveThemePayload(payload, snapshot) {
  if (!payload?.ok || !snapshot?.topRankings?.length) return payload
  const bySymbol = liveMap(snapshot)

  const topRankings = (payload.topRankings ?? []).map((item) => withCatalogThemes(mergeRanking(item, bySymbol.get(item.symbol))))
  const themes = (payload.themes ?? []).map((theme) => {
    const deltaEntries = []
    const members = (theme.members ?? []).map((member) => {
      const live = bySymbol.get(member.symbol)
      const staleRate = number(member.changeRate)
      const liveRate = number(live?.changeRate)
      if (staleRate != null && liveRate != null) {
        deltaEntries.push({
          delta: liveRate - staleRate,
          weight: Math.max(0, number(live?.tradingAmount) ?? number(member.tradingAmount) ?? 0),
        })
      }
      return withCatalogThemes(mergeRanking(member, live))
    })

    const liveDelta = weightedLiveDelta(deltaEntries)
    const points = [...(theme.points ?? [])]
    if (points.length && Number.isFinite(liveDelta) && Math.abs(liveDelta) > 0.000001) {
      const last = points.at(-1)
      const previousClose = number(last.closeValue) ?? number(last.value) ?? 0
      const nextClose = previousClose + liveDelta
      const openValue = number(last.openValue) ?? previousClose
      const highValue = Math.max(number(last.highValue) ?? Math.max(openValue, previousClose), nextClose)
      const lowValue = Math.min(number(last.lowValue) ?? Math.min(openValue, previousClose), nextClose)
      points[points.length - 1] = {
        ...last,
        value: nextClose,
        openValue,
        highValue,
        lowValue,
        closeValue: nextClose,
        live: true,
      }
    }

    const currentValue = points.length ? number(points.at(-1)?.value) : number(theme.currentValue)
    const tradingAmount = members.reduce((sum, member) => sum + (number(member.tradingAmount) ?? 0), 0)
    const maxMemberAmount = Math.max(0, ...members.map((member) => number(member.tradingAmount) ?? 0))
    return {
      ...theme,
      members,
      points,
      tradingAmount,
      currentValue,
      change1h: number(theme.change1h) != null ? number(theme.change1h) + liveDelta : null,
      change3h: number(theme.change3h) != null ? number(theme.change3h) + liveDelta : null,
      dominantWeightPercent: tradingAmount > 0 ? maxMemberAmount / tradingAmount * 100 : theme.dominantWeightPercent ?? null,
      liveWeighting: 'current-cumulative-trading-amount',
      liveUpdatedAt: snapshot.updatedAt ?? null,
    }
  })

  return {
    ...payload,
    updatedAt: snapshot.updatedAt ?? payload.updatedAt ?? null,
    sourceUpdatedAt: snapshot.updatedAt ?? payload.sourceUpdatedAt ?? null,
    topRankings,
    themes,
    liveOverlay: true,
  }
}
