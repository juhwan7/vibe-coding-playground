import { buildThemeGroups, themesForStock, themeCatalogMetadata } from './themeCatalog.mjs'

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function median(values) {
  const clean = values.map(number).filter((value) => value != null).sort((a, b) => a - b)
  if (!clean.length) return null
  const mid = Math.floor(clean.length / 2)
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2
}

function kstDate(value = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value))
}

function ageSeconds(timestamp, now = Date.now()) {
  const parsed = Date.parse(timestamp ?? '')
  return Number.isFinite(parsed) ? Math.max(0, Math.round((now - parsed) / 1000)) : null
}

export function freshness(timestamp, expectedSeconds = 10, { mode = null, now = Date.now() } = {}) {
  const age = ageSeconds(timestamp, now)
  if (String(mode ?? '').includes('cache')) {
    return { status: 'fallback', label: 'FALLBACK', ageSeconds: age, timestamp: timestamp ?? null }
  }
  if (age == null) return { status: 'missing', label: 'MISSING', ageSeconds: null, timestamp: timestamp ?? null }
  if (age <= expectedSeconds * 2.5) return { status: 'live', label: 'LIVE', ageSeconds: age, timestamp }
  if (age <= Math.max(120, expectedSeconds * 6)) return { status: 'delayed', label: 'DELAYED', ageSeconds: age, timestamp }
  return { status: 'stale', label: 'STALE', ageSeconds: age, timestamp }
}

function evidenceGrade(item = {}) {
  const source = String(item.source ?? '')
  const text = `${item.title ?? ''} ${item.summary ?? ''} ${source}`
  const sourceCount = Math.max(1, Number(item.sourceCount ?? 1) || 1)
  if (/DART|전자공시|금융감독원|한국거래소|KRX|공시/i.test(text) && /공시|전자공시|거래소|금융감독원/i.test(source)) {
    return { grade: 'A', label: '1차자료 확인', confidence: 'high' }
  }
  if (sourceCount >= 2) return { grade: 'B', label: `복수 출처 ${sourceCount}곳`, confidence: 'medium' }
  return { grade: 'C', label: '단일 기사', confidence: 'unverified' }
}

export function gradeNewsPayload(payload = {}) {
  return {
    ...payload,
    items: (payload.items ?? []).map((item) => ({ ...item, evidence: evidenceGrade(item) })),
  }
}

function stockBreadth(snapshot = {}) {
  const list = Object.values(snapshot.stocks ?? {}).filter((stock) => number(stock?.changeRate) != null)
  const fallback = (snapshot.topRankings ?? []).filter((stock) => number(stock?.changeRate) != null)
  const source = list.length >= 20 ? list : fallback
  if (!source.length) return { sampleCount: 0, advancers: 0, decliners: 0, advancerShare: null, upAmountShare: null }
  let advancers = 0
  let decliners = 0
  let upAmount = 0
  let totalAmount = 0
  for (const stock of source) {
    const rate = number(stock.changeRate) ?? 0
    const amount = Math.max(0, number(stock.tradingAmount) ?? 0)
    if (rate > 0) advancers += 1
    if (rate < 0) decliners += 1
    if (rate > 0) upAmount += amount
    totalAmount += amount
  }
  return {
    sampleCount: source.length,
    advancers,
    decliners,
    advancerShare: source.length ? advancers / source.length * 100 : null,
    upAmountShare: totalAmount > 0 ? upAmount / totalAmount * 100 : null,
  }
}

function topConcentration(snapshot = {}, count = 10) {
  const amounts = (snapshot.topRankings ?? []).map((item) => Math.max(0, number(item.tradingAmount) ?? 0)).sort((a, b) => b - a)
  const total = number(snapshot.marketTradingAmount) ?? amounts.reduce((sum, value) => sum + value, 0)
  if (!total) return null
  return amounts.slice(0, count).reduce((sum, value) => sum + value, 0) / total * 100
}

function currentMarketSummary(snapshot, themes) {
  const breadth = stockBreadth(snapshot)
  const concentration = topConcentration(snapshot)
  const investors = snapshot?.marketInvestors?.total ?? {}
  const foreign = number(investors.foreignerNetBuyAmount)
  const institution = number(investors.institutionNetBuyAmount)
  const nonArb = number(snapshot?.programSummary?.nonArbitrageNetBuyVolume)
  const spread = themes.length ? themes.filter((theme) => (theme.breadthPercent ?? 0) >= 60).length : 0

  let score = 0
  if (breadth.advancerShare != null) score += (breadth.advancerShare - 50) * 0.7
  if (breadth.upAmountShare != null) score += (breadth.upAmountShare - 50) * 0.7
  if (foreign != null) score += Math.sign(foreign) * 7
  if (institution != null) score += Math.sign(institution) * 4
  if (nonArb != null) score += Math.sign(nonArb) * 4
  score += spread * 3
  if (concentration != null && concentration > 45) score -= Math.min(10, (concentration - 45) * 0.5)
  score = clamp(score, -50, 50)

  let label = '중립 장세'
  if (score >= 18) label = '위험선호 우위'
  else if (score <= -18) label = '방어적 장세'
  else if ((breadth.upAmountShare ?? 50) >= 60) label = '상승 거래대금 우위'
  else if ((breadth.upAmountShare ?? 50) <= 40) label = '하락 거래대금 우위'

  const reasons = []
  if (breadth.upAmountShare != null) reasons.push(`상승 종목 거래대금 ${breadth.upAmountShare.toFixed(0)}%`)
  if (breadth.advancerShare != null) reasons.push(`상승 종목 비율 ${breadth.advancerShare.toFixed(0)}%`)
  if (foreign != null) reasons.push(`외국인 현물 ${foreign >= 0 ? '순매수' : '순매도'}`)
  if (nonArb != null) reasons.push(`비차익 프로그램 ${nonArb >= 0 ? '순매수' : '순매도'}`)
  if (spread) reasons.push(`확산형 주도테마 ${spread}개`)
  if (concentration != null) reasons.push(`TOP10 집중도 ${concentration.toFixed(1)}%`)

  return { label, score: Math.round(score), breadth, concentration, reasons }
}

function flowSeries(history = {}) {
  return (history.samples ?? []).slice(-180).map((sample) => ({
    timestamp: sample.updatedAt,
    foreign: number(sample?.marketInvestors?.total?.foreignerNetBuyAmount),
    institution: number(sample?.marketInvestors?.total?.institutionNetBuyAmount),
    nonArbitrage: number(sample?.programSummary?.nonArbitrageNetBuyVolume),
    arbitrage: number(sample?.programSummary?.arbitrageNetBuyVolume),
    marketTradingAmount: number(sample.marketTradingAmount),
  }))
}

function lifecycle(theme, state, now) {
  const ageMinutes = Math.max(0, (now - state.firstSeenAt) / 60000)
  const breadth = theme.breadthPercent ?? 0
  const momentum = number(theme.change1h) ?? 0
  const current = number(theme.currentValue) ?? 0
  const velocity = number(theme.flowVelocity10mPercent) ?? 0
  const concentration = theme.leaderConcentrationPercent ?? 0

  if (momentum < -0.7 && breadth < 40) return '이탈'
  if (current >= 4 && concentration >= 60) return '과열'
  if (momentum < 0 && velocity < 0.2) return '둔화'
  if (breadth >= 70 && momentum >= 0.4 && velocity > 0) return '주도'
  if (breadth >= 60 && velocity >= 0) return '확산'
  if (ageMinutes <= 20) return '출현'
  return '유지'
}

export class MarketIntelligenceService {
  constructor({
    replacementMargin = 0.08,
    replacementConfirmations = 3,
    themeCount = 4,
    rankPromotionMargin = 0.02,
    rankImmediateMargin = null,
    rankConfirmations = null,
  } = {}) {
    this.replacementMargin = replacementMargin
    this.replacementConfirmations = replacementConfirmations
    this.themeCount = themeCount
    this.rankPromotionMargin = rankPromotionMargin
    this.rankImmediateMargin = rankImmediateMargin ?? replacementMargin
    this.rankConfirmations = rankConfirmations ?? replacementConfirmations
    this.rankChallenges = new Map()
    this.themeState = new Map()
    this.selectedNames = []
    this.previousMarketAmount = null
    this.previousMarketDay = null
  }

  stabilizeThemeOrder(candidates = []) {
    const sorted = [...candidates].sort((a, b) => (number(b.strengthScore) ?? -Infinity) - (number(a.strengthScore) ?? -Infinity))
    if (!this.selectedNames.length) {
      this.rankChallenges.clear()
      return sorted
    }

    const byName = new Map(sorted.map((theme) => [theme.name, theme]))
    const ordered = []
    const used = new Set()
    for (const name of this.selectedNames) {
      const theme = byName.get(name)
      if (!theme) continue
      ordered.push(theme)
      used.add(name)
    }
    for (const theme of sorted) {
      if (used.has(theme.name)) continue
      ordered.push(theme)
      used.add(theme.name)
    }

    const observedChallenges = new Set()
    for (let pass = 0; pass < ordered.length; pass += 1) {
      let moved = false
      for (let index = 1; index < ordered.length; index += 1) {
        const incumbent = ordered[index - 1]
        const challenger = ordered[index]
        const incumbentScore = number(incumbent.strengthScore) ?? -Infinity
        const challengerScore = number(challenger.strengthScore) ?? -Infinity
        const key = `${challenger.name}>${incumbent.name}`

        if (!(challengerScore > incumbentScore)) {
          this.rankChallenges.delete(key)
          continue
        }

        const lead = (challengerScore - incumbentScore) / Math.max(1, Math.abs(incumbentScore))
        if (lead >= this.rankImmediateMargin) {
          ordered[index - 1] = challenger
          ordered[index] = incumbent
          this.rankChallenges.delete(key)
          moved = true
          continue
        }

        if (lead < this.rankPromotionMargin) {
          this.rankChallenges.delete(key)
          continue
        }

        let confirmations = this.rankChallenges.get(key) ?? 0
        if (!observedChallenges.has(key)) {
          confirmations += 1
          this.rankChallenges.set(key, confirmations)
          observedChallenges.add(key)
        }
        if (confirmations >= this.rankConfirmations) {
          ordered[index - 1] = challenger
          ordered[index] = incumbent
          this.rankChallenges.delete(key)
          moved = true
        }
      }
      if (!moved) break
    }

    for (const key of [...this.rankChallenges.keys()]) {
      if (!observedChallenges.has(key)) this.rankChallenges.delete(key)
    }
    return ordered
  }

  enrichThemes(payload = {}, now = Date.now()) {
    const rawThemes = (payload.themes ?? []).map((theme) => ({ ...theme }))
    const seenNow = new Set(rawThemes.map((theme) => theme.name))
    const enriched = []

    for (const theme of rawThemes) {
      const members = theme.members ?? []
      const rates = members.map((member) => number(member.changeRate)).filter((value) => value != null)
      const positives = rates.filter((value) => value > 0).length
      const totalAmount = members.reduce((sum, member) => sum + Math.max(0, number(member.tradingAmount) ?? 0), 0)
      const leaderAmount = Math.max(0, ...members.map((member) => number(member.tradingAmount) ?? 0))
      const adjustedAmount = members.reduce((sum, member) => {
        const amount = Math.max(0, number(member.tradingAmount) ?? 0)
        const overlap = Math.max(1, themesForStock(member.symbol, member.name).length)
        return sum + amount / overlap
      }, 0)

      const previous = this.themeState.get(theme.name)
      const amount = number(theme.tradingAmount) ?? totalAmount
      const elapsedMinutes = previous ? Math.max(0.2, (now - previous.lastSeenAt) / 60000) : null
      const delta = previous ? amount - previous.tradingAmount : null
      const flowVelocity10mPercent = previous && previous.tradingAmount > 0
        ? (delta / previous.tradingAmount) * (10 / elapsedMinutes) * 100
        : null
      const breadthPercent = rates.length ? positives / rates.length * 100 : null
      const medianReturn = median(rates)
      const leaderConcentrationPercent = totalAmount > 0 ? leaderAmount / totalAmount * 100 : null
      const firstSeenAt = previous?.firstSeenAt ?? now
      const baseStrength = Math.log10(Math.max(1, amount)) * 4
        + (breadthPercent ?? 50) * 0.18
        + clamp((number(theme.currentValue) ?? 0) * 2, -10, 18)
        + clamp((number(theme.change1h) ?? 0) * 1.5, -8, 12)
        + clamp(flowVelocity10mPercent ?? 0, -8, 20)
        - clamp((leaderConcentrationPercent ?? 0) - 65, 0, 25) * 0.2

      const nextState = {
        firstSeenAt,
        lastSeenAt: now,
        tradingAmount: amount,
        missingCount: 0,
      }
      const item = {
        ...theme,
        tradingAmount: amount,
        overlapAdjustedTradingAmount: adjustedAmount,
        breadthPercent,
        medianReturn,
        leaderConcentrationPercent,
        flowVelocity10mPercent,
        strengthScore: Number(baseStrength.toFixed(2)),
      }
      item.lifecycle = lifecycle(item, nextState, now)
      this.themeState.set(theme.name, { ...nextState, lastPayload: item })
      enriched.push(item)
    }

    for (const [name, state] of this.themeState) {
      if (seenNow.has(name)) continue
      state.missingCount = (state.missingCount ?? 0) + 1
      this.themeState.set(name, state)
    }

    const byName = new Map(enriched.map((theme) => [theme.name, theme]))
    const newcomers = enriched.filter((theme) => !this.selectedNames.includes(theme.name)).sort((a, b) => b.strengthScore - a.strengthScore)
    const retained = []

    for (const name of this.selectedNames) {
      const live = byName.get(name)
      if (live) {
        retained.push(live)
        continue
      }
      const state = this.themeState.get(name)
      const stale = state?.lastPayload
      const challenger = newcomers[0]
      const shouldHold = stale && (state?.missingCount ?? 0) < this.replacementConfirmations
        && (!challenger || challenger.strengthScore < stale.strengthScore * (1 + this.replacementMargin))
      if (shouldHold) retained.push({ ...stale, hysteresisHold: true, lifecycle: '둔화' })
    }

    const selected = [...retained]
    const selectedSet = new Set(selected.map((theme) => theme.name))
    for (const candidate of enriched.sort((a, b) => b.strengthScore - a.strengthScore)) {
      if (selectedSet.has(candidate.name)) continue
      selected.push(candidate)
      selectedSet.add(candidate.name)
      if (selected.length >= this.themeCount) break
    }

    const finalThemes = this.stabilizeThemeOrder(selected).slice(0, this.themeCount)
    this.selectedNames = finalThemes.map((theme) => theme.name)
    return finalThemes
  }

  dataQuality(snapshot = {}, themePayload = {}, now = Date.now()) {
    const issues = []
    const snapFresh = freshness(snapshot.updatedAt, 10, { mode: snapshot.mode, now })
    const themeFresh = freshness(themePayload.sourceUpdatedAt ?? themePayload.updatedAt, 60, { now })
    const rankings = snapshot.topRankings ?? []

    if (['stale', 'missing'].includes(snapFresh.status)) issues.push({ severity: 'critical', code: 'snapshot-stale', message: '시장 스냅샷이 최신 상태가 아닙니다.' })
    else if (snapFresh.status !== 'live') issues.push({ severity: 'warning', code: 'snapshot-delayed', message: '시장 스냅샷 갱신이 지연되고 있습니다.' })
    if (['stale', 'missing'].includes(themeFresh.status)) issues.push({ severity: 'warning', code: 'theme-stale', message: '테마 원천 데이터 갱신이 지연되고 있습니다.' })
    if (rankings.length < 50) issues.push({ severity: 'critical', code: 'ranking-count', message: `거래대금 랭킹 표본이 ${rankings.length}개뿐입니다.` })
    else if (rankings.length < 90) issues.push({ severity: 'warning', code: 'ranking-partial', message: `거래대금 TOP100이 ${rankings.length}개만 수집됐습니다.` })

    const rates = rankings.slice(0, 50).map((item) => number(item.changeRate)).filter((value) => value != null)
    const uniqueRates = new Set(rates.map((value) => value.toFixed(2)))
    if (rates.length >= 20 && uniqueRates.size <= 2) issues.push({ severity: 'warning', code: 'flat-rates', message: '상위 종목 등락률이 비정상적으로 동일합니다.' })

    const currentAmount = number(snapshot.marketTradingAmount)
    const currentDay = snapshot.updatedAt ? kstDate(snapshot.updatedAt) : kstDate(now)
    if (currentDay !== this.previousMarketDay) {
      this.previousMarketDay = currentDay
      this.previousMarketAmount = currentAmount
    } else if (currentAmount != null && this.previousMarketAmount != null && currentAmount < this.previousMarketAmount * 0.98) {
      issues.push({ severity: 'critical', code: 'turnover-decrease', message: '당일 누적 시장 거래대금이 직전 값보다 크게 감소했습니다.' })
    }
    if (currentAmount != null) this.previousMarketAmount = Math.max(currentAmount, this.previousMarketAmount ?? 0)

    const level = issues.some((issue) => issue.severity === 'critical') ? 'critical' : issues.some((issue) => issue.severity === 'warning') ? 'warning' : 'good'
    return { level, issues, freshness: { market: snapFresh, theme: themeFresh } }
  }

  build({ snapshot = {}, themePayload = {}, history = {}, featureNews = {}, futures = null, now = Date.now() } = {}) {
    const themes = this.enrichThemes(themePayload, now)
    const quality = this.dataQuality(snapshot, themePayload, now)
    const gradedNews = gradeNewsPayload(featureNews)
    return {
      ok: Boolean(snapshot?.updatedAt),
      generatedAt: new Date(now).toISOString(),
      sourceUpdatedAt: snapshot?.updatedAt ?? null,
      themeCatalog: themeCatalogMetadata,
      quality,
      freshness: {
        market: quality.freshness.market,
        theme: quality.freshness.theme,
        news: freshness(gradedNews.updatedAt, 180, { now }),
        futures: freshness(futures?.updatedAt, 15, { now }),
      },
      market: currentMarketSummary(snapshot, themes),
      themes,
      flowSeries: flowSeries(history),
      news: gradedNews,
      futures: futures ?? { available: false, source: null, note: '검증된 선물 데이터 공급원이 아직 연결되지 않았습니다.' },
      rules: {
        themeCount: this.themeCount,
        replacementMarginPercent: this.replacementMargin * 100,
        replacementConfirmations: this.replacementConfirmations,
        rankPromotionMarginPercent: this.rankPromotionMargin * 100,
        rankImmediateMarginPercent: this.rankImmediateMargin * 100,
        rankPromotionConfirmations: this.rankConfirmations,
        rankHysteresis: '2% 이상 우위 3회 연속 확인 또는 8% 이상 우위 시 즉시 승격',
        overlapAdjustment: '1/N allocation by verified theme memberships',
        lifecycle: ['출현', '확산', '주도', '과열', '둔화', '이탈', '유지'],
      },
    }
  }
}

export function buildEventTimeline({ stock = null, chart = null, news = null } = {}) {
  if (!stock?.symbol) return { ok: false, stock: null, events: [] }
  const events = []
  for (const point of chart?.points ?? []) {
    events.push({ type: 'price', timestamp: point.timestamp, price: number(point.closePrice), title: null })
  }
  const name = String(stock.name ?? '').toLowerCase()
  for (const item of news?.items ?? []) {
    const matched = (item.matchedStocks ?? []).some((matchedStock) => matchedStock?.symbol === stock.symbol)
      || (name && `${item.title ?? ''} ${item.summary ?? ''}`.toLowerCase().includes(name))
    if (!matched) continue
    events.push({
      type: 'news',
      timestamp: item.publishedAt ?? item.lastPublishedAt ?? null,
      title: item.summary ?? item.title,
      source: item.source ?? null,
      link: item.link ?? null,
      evidence: item.evidence ?? evidenceGrade(item),
    })
  }
  events.sort((a, b) => Date.parse(a.timestamp ?? 0) - Date.parse(b.timestamp ?? 0))
  return { ok: true, stock, events }
}

export function buildReplay(history = {}, { maxSamples = 360 } = {}) {
  const samples = (history.samples ?? []).slice(-maxSamples).map((sample) => {
    const themes = buildThemeGroups(sample.topRankings ?? [], { limit: 100, minMembers: 2, maxThemes: 4 })
    return {
      timestamp: sample.updatedAt,
      marketSession: sample.marketSession ?? null,
      marketTradingAmount: number(sample.marketTradingAmount),
      indices: sample.indices ?? {},
      marketInvestors: sample.marketInvestors ?? null,
      programSummary: sample.programSummary ?? null,
      topRankings: (sample.topRankings ?? []).slice(0, 20),
      themes: themes.map((theme) => ({ name: theme.name, tradingAmount: theme.tradingAmount, memberCount: theme.members.length })),
    }
  })
  return { ok: true, samples, count: samples.length, generatedAt: new Date().toISOString() }
}