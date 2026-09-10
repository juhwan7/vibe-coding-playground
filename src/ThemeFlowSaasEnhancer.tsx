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
  themes?: Array<{
    name?: string | null
    lifecycle?: string | null
  }>
}

type RankMovement = {
  kind: 'up' | 'down' | 'new' | 'same'
  delta: number
  label: string
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

export function themeRankMovements(previous: string[], current: string[]) {
  const result: Record<string, RankMovement> = {}
  const previousRanks = new Map(previous.map((name, index) => [name, index + 1]))
  for (const [index, name] of current.entries()) {
    const rank = index + 1
    const oldRank = previousRanks.get(name)
    if (!previous.length) result[name] = { kind: 'same', delta: 0, label: '' }
    else if (oldRank == null) result[name] = { kind: 'new', delta: 0, label: 'NEW' }
    else if (oldRank > rank) result[name] = { kind: 'up', delta: oldRank - rank, label: `↑${oldRank - rank}` }
    else if (oldRank < rank) result[name] = { kind: 'down', delta: rank - oldRank, label: `↓${rank - oldRank}` }
    else result[name] = { kind: 'same', delta: 0, label: '' }
  }
  return result
}

const LIFECYCLE_STAGES = ['출현', '확산', '주도', '과열', '둔화', '이탈'] as const

export function lifecycleStageIndex(value: string | null | undefined) {
  return LIFECYCLE_STAGES.indexOf(String(value ?? '').trim() as typeof LIFECYCLE_STAGES[number])
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

function updateSummaryBar(themeFlow: ThemeFlowPayload | null, intel: IntelligencePayload | null, rankMovements: Record<string, RankMovement>) {
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
    const movement = rankMovements[theme.name]
    if (movement?.label) {
      chip.dataset.rankChange = movement.label
      chip.classList.add(`rank-${movement.kind}`)
    }
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

function updateThemeRows(
  themeFlow: ThemeFlowPayload | null,
  intel: IntelligencePayload | null,
  timelineByTheme: Map<string, TimelineEvent[]>,
  rankMovements: Record<string, RankMovement>,
  spotlightTheme: string | null,
) {
  const themes = (themeFlow?.themes ?? []).slice(0, 5)
  const rows = [...document.querySelectorAll<HTMLElement>('.theme-flow-workspace .theme-strength-row')]

  rows.forEach((row, index) => {
    const theme = themes[index]
    row.classList.add('theme-saas-row')
    row.classList.toggle('theme-leader-row', index === 0)
    row.dataset.themeName = theme?.name ?? ''
    row.classList.remove('theme-rank-up', 'theme-rank-down', 'theme-rank-new')
    const movement = theme ? rankMovements[theme.name] : null
    if (movement && movement.kind !== 'same') row.classList.add(`theme-rank-${movement.kind}`)
    row.classList.remove('theme-strength-hot', 'theme-strength-warm', 'theme-strength-negative', 'theme-strength-flat')
    const strength = numberOrNull(theme?.currentValue) ?? 0
    if (strength >= 5) row.classList.add('theme-strength-hot')
    else if (strength > 0.3) row.classList.add('theme-strength-warm')
    else if (strength < -0.3) row.classList.add('theme-strength-negative')
    else row.classList.add('theme-strength-flat')

    const concentration = Math.max(0, Math.min(100, numberOrNull(theme?.dominantWeightPercent) ?? 0))
    const summary = row.querySelector<HTMLElement>('.theme-summary-cell')
    if (summary) {
      const rankLine = summary.querySelector<HTMLElement>('.theme-rank-line')
      rankLine?.querySelector('.theme-rank-delta')?.remove()
      if (rankLine && movement?.label) {
        const delta = createElement('span', `theme-rank-delta rank-${movement.kind}`, movement.label)
        delta.setAttribute('aria-label', movement.kind === 'new' ? '새로 진입' : `이전 순위 대비 ${movement.label}`)
        rankLine.append(delta)
      }

      summary.querySelector('.theme-lifecycle-panel')?.remove()
      if (theme) {
        const lifecycle = intel?.themes?.find((item) => item.name === theme.name)?.lifecycle ?? '확인 중'
        const lifecycleIndex = lifecycleStageIndex(lifecycle)
        const panel = createElement('div', 'theme-lifecycle-panel')
        const head = createElement('div', 'theme-lifecycle-head')
        const label = createElement('span', '', '테마 생명주기')
        label.append(createElement('b', '', lifecycle))
        const spotlight = createElement('button', 'theme-spotlight-toggle', spotlightTheme === theme.name ? '집중 해제' : '집중 보기')
        spotlight.type = 'button'
        spotlight.dataset.themeName = theme.name
        spotlight.setAttribute('aria-pressed', spotlightTheme === theme.name ? 'true' : 'false')
        spotlight.title = `${theme.name} 관련 종목만 강조합니다.`
        head.append(label, spotlight)

        const track = createElement('div', 'theme-lifecycle-track')
        LIFECYCLE_STAGES.forEach((stage, stageIndex) => {
          const step = createElement('i')
          step.title = stage
          if (lifecycleIndex >= 0 && stageIndex <= lifecycleIndex) step.classList.add('passed')
          if (lifecycleIndex === stageIndex) step.classList.add('active')
          track.append(step)
        })
        if (lifecycleIndex < 0) track.classList.add('neutral')
        panel.append(head, track)
        const lastStat = summary.lastElementChild
        if (lastStat) summary.insertBefore(panel, lastStat)
        else summary.append(panel)
      }

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

function updateTop100Heat(previousAmounts: Map<string, number>) {
  const rows = [...document.querySelectorAll<HTMLElement>('.theme-flow-workspace .top100-row')]
  const shares = rows.map((row) => {
    const text = row.querySelector('.top100-share')?.textContent ?? ''
    const match = text.match(/([\d.]+)%/)
    return match ? Number(match[1]) : null
  })
  const max = Math.max(0, ...shares.filter((value): value is number => value != null && Number.isFinite(value)))
  const currentAmounts = new Map<string, number>()
  const deltas: Array<{ symbol: string; delta: number }> = []
  rows.forEach((row) => {
    const symbol = row.dataset.symbol ?? ''
    const amount = Number(row.dataset.tradingAmount)
    if (!symbol || !Number.isFinite(amount)) return
    currentAmounts.set(symbol, amount)
    const previous = previousAmounts.get(symbol)
    if (previous != null && amount > previous) deltas.push({ symbol, delta: amount - previous })
  })
  const totalDelta = deltas.reduce((sum, item) => sum + item.delta, 0)
  const surgeSymbols = new Set(
    deltas
      .filter((item) => item.delta >= Math.max(50_000_000, totalDelta * .05))
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3)
      .map((item) => item.symbol),
  )

  rows.forEach((row, index) => {
    const alpha = turnoverHeat(shares[index], max)
    row.style.setProperty('--top100-heat-alpha', String(alpha))
    row.classList.toggle('top100-turnover-surge', surgeSymbols.has(row.dataset.symbol ?? ''))
  })
  previousAmounts.clear()
  currentAmounts.forEach((value, symbol) => previousAmounts.set(symbol, value))
}

function applySpotlight(themeName: string | null) {
  const workspace = document.querySelector<HTMLElement>('.theme-flow-workspace:not(.us-theme-workspace)')
  if (!workspace) return
  workspace.classList.toggle('theme-spotlight-active', Boolean(themeName))
  workspace.dataset.spotlightTheme = themeName ?? ''

  const rows = [...workspace.querySelectorAll<HTMLElement>('.theme-strength-row')]
  rows.forEach((row) => {
    const matches = Boolean(themeName) && row.dataset.themeName === themeName
    row.classList.toggle('spotlight-match', matches)
    row.classList.toggle('spotlight-muted', Boolean(themeName) && !matches)
    const button = row.querySelector<HTMLButtonElement>('.theme-spotlight-toggle')
    if (button) {
      const selected = Boolean(themeName) && button.dataset.themeName === themeName
      button.setAttribute('aria-pressed', selected ? 'true' : 'false')
      button.textContent = selected ? '집중 해제' : '집중 보기'
    }
  })

  const topRows = [...workspace.querySelectorAll<HTMLElement>('.top100-row')]
  topRows.forEach((row) => {
    const matches = Boolean(themeName) && row.dataset.themeName === themeName
    row.classList.toggle('spotlight-match', matches)
    row.classList.toggle('spotlight-muted', Boolean(themeName) && !matches)
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
    let rankMovements: Record<string, RankMovement> = {}
    let previousThemeNames: string[] = []
    let spotlightTheme: string | null = null
    const previousAmounts = new Map<string, number>()
    let lastFetch = 0
    let loading = false

    const apply = () => {
      if (!document.querySelector('.theme-flow-workspace:not(.us-theme-workspace)')) return
      updateSummaryBar(themeFlow, intel, rankMovements)
      updateThemeRows(themeFlow, intel, timelineByTheme, rankMovements, spotlightTheme)
      updateTop100Heat(previousAmounts)
      applySpotlight(spotlightTheme)
    }

    const load = async () => {
      if (loading || controller.signal.aborted || !document.querySelector('.theme-flow-workspace:not(.us-theme-workspace)')) return
      loading = true
      try {
        const [nextThemeFlow, nextIntel] = await Promise.all([
          fetchJson<ThemeFlowPayload>('/api/market/theme-flow', controller.signal),
          fetchJson<IntelligencePayload>('/api/market/intelligence', controller.signal),
        ])
        if (nextThemeFlow) {
          const nextNames = (nextThemeFlow.themes ?? []).slice(0, 5).map((theme) => theme.name)
          rankMovements = themeRankMovements(previousThemeNames, nextNames)
          previousThemeNames = nextNames
          themeFlow = nextThemeFlow
          if (spotlightTheme && !nextNames.includes(spotlightTheme)) spotlightTheme = null
        }
        if (nextIntel) intel = nextIntel
        if (themeFlow?.themes?.length) timelineByTheme = await loadTimelines(themeFlow.themes, timelineCache, controller.signal)
        lastFetch = Date.now()
        apply()
      } finally {
        loading = false
      }
    }

    const tick = () => {
      if (!document.querySelector('.theme-flow-workspace:not(.us-theme-workspace)')) return
      apply()
      if (Date.now() - lastFetch >= 9_500) void load()
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const button = target?.closest<HTMLButtonElement>('.theme-spotlight-toggle')
      if (!button?.dataset.themeName) return
      spotlightTheme = spotlightTheme === button.dataset.themeName ? null : button.dataset.themeName
      apply()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !spotlightTheme) return
      spotlightTheme = null
      apply()
    }

    document.addEventListener('click', onClick)
    window.addEventListener('keydown', onKeyDown)
    const timer = window.setInterval(tick, 1_000)
    tick()
    return () => {
      controller.abort()
      document.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKeyDown)
      window.clearInterval(timer)
    }
  }, [])

  return null
}
