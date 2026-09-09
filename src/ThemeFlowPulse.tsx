import { useEffect, useMemo, useState } from 'react'

type RankingItem = {
  name?: string | null
  securityType?: string | null
  changeRate?: number | null
  tradingAmount?: number | null
}

type ThemeGroup = {
  name: string
  tradingAmount?: number | null
  currentValue?: number | null
}

type ThemeFlowPayload = {
  ok?: boolean
  updatedAt?: string | null
  themes?: ThemeGroup[]
  topRankings?: RankingItem[]
}

const NON_STOCK_NAME = /(ETF|ETN|KODEX|TIGER|RISE|ACE|PLUS|SOL|HANARO|KOSEF|TIMEFOLIO|ARIRANG|FOCUS|KBSTAR|리츠|스팩|인프라)/i

function isIndividualStock(item: RankingItem) {
  const type = String(item.securityType ?? '').toUpperCase()
  if (type) return type === 'STOCK'
  return Boolean(item.name) && !NON_STOCK_NAME.test(String(item.name))
}

function fmtRate(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function displayTime(value?: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function breadthLabel(value: number | null) {
  if (value == null) return '계산 중'
  if (value >= 65) return '강한 확산'
  if (value >= 45) return '보통'
  return '선별 확산'
}

export default function ThemeFlowPulse() {
  const [payload, setPayload] = useState<ThemeFlowPayload>({ ok: false, themes: [], topRankings: [] })

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const load = async () => {
      try {
        const response = await fetch('/api/market/theme-flow', {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        }).catch(() => null)
        const next = response ? await response.json().catch(() => null) as ThemeFlowPayload | null : null
        if (next) setPayload(next)
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(load, 10000)
      }
    }
    void load()
    return () => {
      controller.abort()
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  const summary = useMemo(() => {
    const themes = (payload.themes ?? []).slice(0, 5)
    const stocks = (payload.topRankings ?? []).filter(isIndividualStock)
    const totalAmount = stocks.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)
    const leaderAmount = themes[0]?.tradingAmount ?? 0
    const leaderShare = totalAmount > 0 ? Math.min(100, leaderAmount / totalAmount * 100) : null
    const measured = stocks.filter((item) => item.changeRate != null && Number.isFinite(item.changeRate))
    const rising = measured.filter((item) => (item.changeRate ?? 0) > 0).length
    const breadth = measured.length ? rising / measured.length * 100 : null
    return { themes, leaderShare, breadth, rising, measured: measured.length }
  }, [payload])

  return <section className="theme-flow-pulse" data-testid="theme-flow-pulse" aria-label="현재 시장 주도 테마 요약">
    <div className="theme-flow-pulse-leaders">
      <div className="theme-flow-pulse-title"><span>MARKET PULSE</span><strong>현재 시장 주도 테마</strong></div>
      <div className="theme-flow-pulse-chips">
        {summary.themes.slice(0, 3).map((theme, index) => <span key={theme.name}>
          <b>{index + 1}</b>{theme.name}<em className={(theme.currentValue ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.currentValue)}</em>
        </span>)}
        {!summary.themes.length && <span className="is-loading">테마 순위 계산 중</span>}
      </div>
    </div>

    <div className="theme-flow-pulse-metrics">
      <div>
        <span>1위 테마 거래대금 비중</span>
        <strong>{summary.leaderShare == null ? '-' : `${summary.leaderShare.toFixed(1)}%`}</strong>
        <div className="theme-flow-pulse-track"><i style={{ width: `${Math.max(0, Math.min(100, summary.leaderShare ?? 0))}%` }} /></div>
      </div>
      <div>
        <span>시장 확산도</span>
        <strong>{breadthLabel(summary.breadth)}</strong>
        <small>{summary.breadth == null ? '상승 종목 계산 중' : `상승 ${summary.rising}/${summary.measured} · ${summary.breadth.toFixed(0)}%`}</small>
      </div>
      <div>
        <span>데이터</span>
        <strong className={payload.ok ? 'is-live' : 'is-waiting'}>{payload.ok ? '10초 최신' : '준비 중'}</strong>
        <small>{displayTime(payload.updatedAt)}</small>
      </div>
    </div>
  </section>
}
