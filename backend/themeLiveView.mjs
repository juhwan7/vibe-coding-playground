function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function liveMap(snapshot) {
  return new Map((snapshot?.topRankings ?? []).filter((item) => item?.symbol).map((item) => [item.symbol, item]))
}

function mergeRanking(base, live) {
  if (!live) return base
  return {
    ...base,
    lastPrice: number(live.lastPrice) ?? base?.lastPrice ?? null,
    changeRate: number(live.changeRate) ?? base?.changeRate ?? null,
    tradingAmount: number(live.tradingAmount) ?? base?.tradingAmount ?? null,
    tradingVolume: number(live.tradingVolume) ?? base?.tradingVolume ?? null,
  }
}

export function buildLiveThemePayload(payload, snapshot) {
  if (!payload?.ok || !snapshot?.topRankings?.length) return payload
  const bySymbol = liveMap(snapshot)

  const topRankings = (payload.topRankings ?? []).map((item) => mergeRanking(item, bySymbol.get(item.symbol)))
  const themes = (payload.themes ?? []).map((theme) => {
    const deltas = []
    const members = (theme.members ?? []).map((member) => {
      const live = bySymbol.get(member.symbol)
      const staleRate = number(member.changeRate)
      const liveRate = number(live?.changeRate)
      if (staleRate != null && liveRate != null) deltas.push(liveRate - staleRate)
      return mergeRanking(member, live)
    })

    const liveDelta = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : 0
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
    return {
      ...theme,
      members,
      points,
      tradingAmount,
      currentValue,
      change1h: number(theme.change1h) != null ? number(theme.change1h) + liveDelta : null,
      change3h: number(theme.change3h) != null ? number(theme.change3h) + liveDelta : null,
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
