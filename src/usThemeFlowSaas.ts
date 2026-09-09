export type UsRankingLike = {
  tradingAmount?: number | null
  changeRate?: number | null
}

export type UsThemeMemberLike = {
  tradingAmount?: number | null
}

export type UsThemeLike = {
  tradingAmount?: number | null
  currentValue?: number | null
  members?: UsThemeMemberLike[] | null
}

export function usMarketBreadth(items: UsRankingLike[]) {
  const valid = items.filter((item) => item.changeRate != null && Number.isFinite(item.changeRate))
  if (!valid.length) return { percent: null as number | null, label: '확인 중', advancers: 0, total: 0 }
  const advancers = valid.filter((item) => (item.changeRate ?? 0) > 0).length
  const percent = advancers / valid.length * 100
  const label = percent >= 60 ? '넓음' : percent >= 45 ? '보통' : '좁음'
  return { percent, label, advancers, total: valid.length }
}

export function usThemeConcentration(theme: UsThemeLike | null | undefined) {
  if (!theme) return null
  const members = theme.members ?? []
  const maxMember = Math.max(0, ...members.map((member) => Number.isFinite(member.tradingAmount) ? Number(member.tradingAmount) : 0))
  const explicitTotal = Number.isFinite(theme.tradingAmount) ? Number(theme.tradingAmount) : 0
  const memberTotal = members.reduce((sum, member) => sum + (Number.isFinite(member.tradingAmount) ? Number(member.tradingAmount) : 0), 0)
  const total = explicitTotal > 0 ? explicitTotal : memberTotal
  if (total <= 0 || maxMember <= 0) return null
  return Math.max(0, Math.min(100, maxMember / total * 100))
}

export function usTurnoverHeat(value: number | null | undefined, maxValue: number | null | undefined) {
  if (value == null || maxValue == null || !Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) return 0.018
  const ratio = Math.max(0, Math.min(1, value / maxValue))
  return Number((0.018 + ratio * 0.105).toFixed(3))
}

export function usThemeStrengthClass(value: number | null | undefined) {
  const strength = value != null && Number.isFinite(value) ? value : 0
  if (strength >= 5) return 'theme-strength-hot'
  if (strength > 0.3) return 'theme-strength-warm'
  if (strength < -0.3) return 'theme-strength-negative'
  return 'theme-strength-flat'
}

export function splitUsThemeLineSegments<T extends { timestamp: string; day: string }>(source: T[], maxGapMs = 15 * 60 * 1000) {
  const points = [...source].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const segments: T[][] = []
  let current: T[] = []

  for (const point of points) {
    const previous = current.at(-1)
    const currentTime = Date.parse(point.timestamp)
    const previousTime = previous ? Date.parse(previous.timestamp) : NaN
    const shouldBreak = Boolean(previous) && (
      previous?.day !== point.day
      || !Number.isFinite(currentTime)
      || !Number.isFinite(previousTime)
      || currentTime - previousTime > maxGapMs
    )

    if (shouldBreak) {
      if (current.length) segments.push(current)
      current = []
    }
    current.push(point)
  }

  if (current.length) segments.push(current)
  return segments
}

export function smoothUsThemeTrend<T extends { timestamp: string; day: string; value: number }>(
  source: T[],
  timeConstantMs = 90_000,
): Array<T & { trendValue: number }> {
  const points = [...source].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  let previousTime = NaN
  let previousDay: string | null = null
  let smoothed = 0
  let initialized = false

  return points.map((point) => {
    const currentTime = Date.parse(point.timestamp)
    const reset = !initialized
      || previousDay !== point.day
      || !Number.isFinite(currentTime)
      || !Number.isFinite(previousTime)
      || currentTime - previousTime > 15 * 60 * 1000

    if (reset) {
      smoothed = point.value
      initialized = true
    } else {
      const elapsed = Math.max(1, currentTime - previousTime)
      const alpha = 1 - Math.exp(-elapsed / Math.max(1, timeConstantMs))
      smoothed = smoothed + alpha * (point.value - smoothed)
    }

    previousTime = currentTime
    previousDay = point.day
    return { ...point, trendValue: smoothed }
  })
}
