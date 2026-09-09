import { useEffect } from 'react'

type ThemeMember = {
  symbol?: string | null
  name?: string | null
  tradingAmount?: number | null
}

type ThemePoint = {
  timestamp?: string | null
  day?: string | null
}

type ThemeGroup = {
  name: string
  currentValue?: number | null
  dominantWeightPercent?: number | null
  members?: ThemeMember[]
  points?: ThemePoint[]
}

type ThemeFlowPayload = {
  ok?: boolean
  updatedAt?: string | null
  themes?: ThemeGroup[]
}

type IntelligencePayload = {
  market?: {
    concentration?: number | null
    breadth?: { advancerShare?: number | null }
  }
}

type TimelineEvent = {
  type?: 'price' | 'news'
  timestamp?: string | null
  title?: string | null
  source?: string | null
}

type TimelinePayload = {
  events?: TimelineEvent[]
}

type TimelineCacheItem = {
  fetchedAt: number
  events: TimelineEvent[]
}

const SESSION_START_MINUTE = 8 * 60
const SESSION_LENGTH_MINUTE = 12 * 60
const TIMELINE_CACHE_MS = 60_000

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function kstParts(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    hour: Number(part('hour')),
    minute: Number(part('minute')),
  }
}

function formatRate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatClock(iso?: string | null) {
  if (!iso) return '-'
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(parsed))
}

export function marketBreadthLabel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '확인 중'
  if (value >= 60) return '넓음'
  if (value >= 45) return '보통'
  return '좁음'
}

export function turnoverHeat(value: number | null | undefined, maxValue: number | null | undefined) {
  if (value == null || maxValue == null || !Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) return 0.018
  const ratio = Math.max(0, Math.min(1, value / maxValue))
  return Number((0.018 + ratio * 0.105).toFixed(3))
}

export function chartEventPosition(timestamp: string | null | undefined, points: ThemePoint[] | null | undefined) {
  if (!timestamp || !points?.length || !Number.isFinite(Date.parse(timestamp))) return null
  const days = [...new Set(points.map((point) => String(point.day ?? '').trim()).filter(Boolean))].sort()
  if (!days.length) return null
  const event = kstParts(timestamp)
  const dayIndex = days.indexOf(event.day)
  if (dayIndex < 0) return null
  const elapsed = Math.max(0, Math.min(SESSION_LENGTH_MINUTE, event.hour * 60 + event.minute - SESSION_START_MINUTE))
  const position = (dayIndex * SESSION_LENGTH_MINUTE + elapsed) / (days.length * SESSION_LENGTH_MINUTE)
  return Math.max(0, Math.min(1, position))
}

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text != null) element.textContent = text
  return element
}

function updateSummaryBar(themeFlow: ThemeFlowPayload | null, intel: IntelligencePayload | null) {
  const board = document.querySelector<HTMLElement>('.theme-flow-workspace .theme-strength-board')
  if (!board) return
  const methodStrip = board.querySelector('.theme-method-strip')
  let bar = board.querySelector<HTMLElement>('.theme-saas-summary-bar')
  if (!bar) {
    bar = createElement('div', 'theme-saas-summary-bar')
    if (methodStrip) methodStrip.before(bar)
    else board.append(bar)
  }

  const themes = (themeFlow?.themes ?? []).slice(0, 3)
  const concentration = numberOrNull(intel?.market?.concentration)
    ?? numberOrNull(themeFlow?.themes?.[0]?.dominantWeightPercent)
  const breadth = numberOrNull(intel?.market?.breadth?.advancerShare)

  const lead = createElement('div', 'theme-saas-summary-lead')
  lead.append(createElement('span', 'theme-saas-kicker', 'LIVE MARKET PULSE'))
  lead.append(createElement('strong', '', '현재 시장 주도 테마'))

  const leaders = createElement('div', 'theme-saas-leaders')
  themes.forEach((theme, index) => {
    const chip = createElement('span', `theme-saas-leader-chip theme-saas-leader-${index + 1}`)
    chip.append(createElement('b', '', `${index + 1}`))
    chip.append(createElement('span', '', theme.name))
    chip.append(createElement('strong', '', formatRate(theme.currentValue)))
    leaders.append(chip)
  })
  if (!themes.length) leaders.append(createElement('span', 'theme-saas-summary-empty', '테마 순위 계산 중'))

  const metrics = createElement('div', 'theme-saas-summary-metrics')
  const concentrationMetric = createElement('span')
  concentrationMetric.append(createElement('small', '', '거래대금 집중도'))
  concentrationMetric.append(createElement('b', '', concentration == null ? '-' : `${concentration.toFixed(1)}%`))
  const breadthMetric = createElement('span')
  breadthMetric.append(createElement('small', '', '시장 확산도'))
  breadthMetric.append(createElement('b', '', `${marketBreadthLabel(breadth)}${breadth == null ? '' : ` · ${breadth.toFixed(0)}%`}`))
  const freshnessMetric = createElement('span')
  freshnessMetric.append(createElement('small', '', '테마 최신화'))
  freshnessMetric.append(createElement('b', '', formatClock(themeFlow?.updatedAt)))
  metrics.append(concentrationMetric, breadthMetric, freshnessMetric)

  bar.replaceChildren(lead, leaders, metrics)
}

function updateThemeRows(themeFlow: ThemeFlowPayload | null, timelineByTheme: Map<string, TimelineEvent[]>) {
  const themes = (themeFlow?.themes ?? []).slice(0, 5)
  const rows = [...document.querySelectorAll<HTMLElement>('.theme-flow-workspace .theme-strength-row')]

  rows.forEach((row, index) => {
    const theme = themes[index]
    row.classList.add('theme-saas-row')
    row.classList.toggle('theme-leader-row', index === 0)
    row.classList.remove('theme-strength-hot', 'theme-strength-warm', 'theme-strength-negative', 'theme-strength-flat')
    const strength = numberOrNull(theme?.currentValue) ?? 0
    if (strength >= 5) row.classList.add('theme-strength-hot')
    else if (strength > 0.3) row.classList.add('theme-strength-warm')
    else if (strength < -0.3) row.classList.add('theme-strength-negative')
    else row.classList.add('theme-strength-flat')

    const concentration = Math.max(0, Math.min(100, numberOrNull(theme?.dominantWeightPercent) ?? 0))
    const summary = row.querySelector<HTMLElement>('.theme-summary-cell')
    if (summary) {
      const stats = [...summary.querySelectorAll<HTMLElement>(':scope > div')]
      const concentrationStat = stats.find((item) => item.querySelector('span')?.textContent?.includes('최대 종목 거래대금 비중'))
      if (concentrationStat) {
        concentrationStat.classList.add('theme-concentration-stat')
        let track = concentrationStat.querySelector<HTMLElement>('.theme-concentration-track')
        if (!track) {
          track = createElement('span', 'theme-concentration-track')
          track.append(createElement('i'))
          concentrationStat.append(track)
        }
        const fill = track.querySelector<HTMLElement>('i')
        if (fill) fill.style.width = `${concentration}%`
        track.setAttribute('aria-label', `최대 종목 거래대금 비중 ${concentration.toFixed(0)}%`)
      }
    }

    const chartWrap = row.querySelector<HTMLElement>('.theme-chart-wrap')
    if (!chartWrap) return
    chartWrap.querySelector('.theme-event-layer')?.remove()
    const chartName = chartWrap.querySelector('.theme-chart-name')?.textContent ?? ''
    if (!theme || !chartName.includes('테마 거래대금 가중')) return

    const newsEvents = (timelineByTheme.get(theme.name) ?? [])
      .filter((event) => event.type === 'news' && event.timestamp && event.title)
      .slice(-2)
    if (!newsEvents.length) return

    const layer = createElement('div', 'theme-event-layer')
    for (const event of newsEvents) {
      const position = chartEventPosition(event.timestamp, theme.points)
      if (position == null) continue
      const marker = createElement('button', 'theme-event-marker')
      marker.type = 'button'
      marker.style.left = `${position * 100}%`
      const leader = [...(theme.members ?? [])].sort((a, b) => (b.tradingAmount ?? 0) - (a.tradingAmount ?? 0))[0]
      const label = `${formatClock(event.timestamp)} ${leader?.name ?? theme.name} · ${event.title}`
      marker.dataset.label = label
      marker.title = `${label}${event.source ? ` · ${event.source}` : ''}`
      marker.setAttribute('aria-label', label)
      marker.append(createElement('i'))
      layer.append(marker)
    }
    if (layer.childElementCount) chartWrap.append(layer)
  })
}

function updateTop100Heat() {
  const rows = [...document.querySelectorAll<HTMLElement>('.theme-flow-workspace .top100-row')]
  const shares = rows.map((row) => {
    const text = row.querySelector('.top100-share')?.textContent ?? ''
    const match = text.match(/([\d.]+)%/)
    return match ? Number(match[1]) : null
  })
  const max = Math.max(0, ...shares.filter((value): value is number => value != null && Number.isFinite(value)))
  rows.forEach((row, index) => {
    const alpha = turnoverHeat(shares[index], max)
    row.style.setProperty('--top100-heat-alpha', String(alpha))
  })
}

async function fetchJson<T>(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } }).catch(() => null)
  if (!response?.ok) return null
  return response.json().catch(() => null) as Promise<T | null>
}

async function loadTimelines(themes: ThemeGroup[], cache: Map<string, TimelineCacheItem>, signal: AbortSignal) {
  const now = Date.now()
  const timelineByTheme = new Map<string, TimelineEvent[]>()
  await Promise.all(themes.slice(0, 5).map(async (theme) => {
    const leader = [...(theme.members ?? [])]
      .filter((member) => /^\d{6}$/.test(String(member.symbol ?? '')))
      .sort((a, b) => (b.tradingAmount ?? 0) - (a.tradingAmount ?? 0))[0]
    const symbol = String(leader?.symbol ?? '')
    if (!symbol) return
    const cached = cache.get(symbol)
    if (cached && now - cached.fetchedAt < TIMELINE_CACHE_MS) {
      timelineByTheme.set(theme.name, cached.events)
      return
    }
    const params = new URLSearchParams({ symbol })
    if (leader?.name) params.set('name', leader.name)
    const payload = await fetchJson<TimelinePayload>(`/api/market/event-timeline?${params.toString()}`, signal)
    const events = payload?.events ?? cached?.events ?? []
    cache.set(symbol, { fetchedAt: now, events })
    timelineByTheme.set(theme.name, events)
  }))
  return timelineByTheme
}

export default function ThemeFlowSaasEnhancer() {
  useEffect(() => {
    const controller = new AbortController()
    const timelineCache = new Map<string, TimelineCacheItem>()
    let themeFlow: ThemeFlowPayload | null = null
    let intel: IntelligencePayload | null = null
    let timelineByTheme = new Map<string, TimelineEvent[]>()
    let lastFetch = 0
    let loading = false

    const apply = () => {
      if (!document.querySelector('.theme-flow-workspace')) return
      updateSummaryBar(themeFlow, intel)
      updateThemeRows(themeFlow, timelineByTheme)
      updateTop100Heat()
    }

    const load = async () => {
      if (loading || controller.signal.aborted || !document.querySelector('.theme-flow-workspace')) return
      loading = true
      try {
        const [nextThemeFlow, nextIntel] = await Promise.all([
          fetchJson<ThemeFlowPayload>('/api/market/theme-flow', controller.signal),
          fetchJson<IntelligencePayload>('/api/market/intelligence', controller.signal),
        ])
        if (nextThemeFlow) themeFlow = nextThemeFlow
        if (nextIntel) intel = nextIntel
        if (themeFlow?.themes?.length) timelineByTheme = await loadTimelines(themeFlow.themes, timelineCache, controller.signal)
        lastFetch = Date.now()
        apply()
      } finally {
        loading = false
      }
    }

    const tick = () => {
      if (!document.querySelector('.theme-flow-workspace')) return
      apply()
      if (Date.now() - lastFetch >= 9_500) void load()
    }

    const timer = window.setInterval(tick, 1_000)
    tick()
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.querySelector('.theme-saas-summary-bar')?.remove()
      document.querySelectorAll('.theme-event-layer').forEach((node) => node.remove())
    }
  }, [])

  return null
}
