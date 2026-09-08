import { useEffect, useMemo, useState } from 'react'
import { mergeLiveSectors, moneyFlowScore } from './marketData'
import type { MarketSnapshot } from './marketData'

function signed(value: number, suffix = '') { return `${value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}` }
function fmtShares(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${value > 0 ? '+' : ''}${(value / 1_000_000).toFixed(1)}백만주`
  if (abs >= 10_000) return `${value > 0 ? '+' : ''}${(value / 10_000).toFixed(1)}만주`
  return `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString()}주`
}
function fmtAmountTrillion(value: number) {
  if (!Number.isFinite(value)) return '-'
  if (value >= 1) return `${value.toFixed(value >= 10 ? 1 : 2)}조`
  return `${Math.round(value * 10_000).toLocaleString()}억`
}
function koreaMinuteNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 8)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return Math.max(0, Math.min(720, (hour - 8) * 60 + minute))
}
function timelineTime(value: number) {
  const hour = 8 + Math.floor(value / 60)
  const minute = value % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

async function fetchSnapshot(signal?: AbortSignal): Promise<MarketSnapshot> {
  const response = await fetch('/api/market/snapshot', { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`market api ${response.status}`)
  return response.json() as Promise<MarketSnapshot>
}

export default function MarketDashboard() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [minute, setMinute] = useState(koreaMinuteNow)
  const [sectorName, setSectorName] = useState('반도체')
  const [themeName, setThemeName] = useState('HBM')

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const load = async () => {
      try {
        const next = await fetchSnapshot(controller.signal)
        setSnapshot(next)
        setApiError(next.error ?? null)
        if (next.ok) setMinute(koreaMinuteNow())
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setApiError('백엔드 연결 대기 중 · Docker 실행 시 토스 실시간 데이터로 전환됩니다.')
      } finally {
        timer = window.setTimeout(load, 5000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [])

  const live = Boolean(snapshot?.ok)
  const sectors = useMemo(() => mergeLiveSectors(snapshot), [snapshot])
  const demoFactor = live ? 1 : 0.72 + (minute / 720) * 0.28
  const ranked = useMemo(() => sectors.map((sector) => ({ ...sector, score: moneyFlowScore(sector) * demoFactor })).sort((a, b) => b.score - a.score), [sectors, demoFactor])
  const selectedSector = sectors.find((sector) => sector.name === sectorName) ?? sectors[0]
  const selectedTheme = selectedSector.themes.find((theme) => theme.name === themeName) ?? selectedSector.themes[0]
  const displayTime = timelineTime(minute)

  const selectSector = (name: string) => {
    const next = sectors.find((sector) => sector.name === name) ?? sectors[0]
    setSectorName(next.name)
    setThemeName(next.themes[0].name)
  }

  const kospi = snapshot?.indices.KOSPI
  const kosdaq = snapshot?.indices.KOSDAQ
  const totalAmount = snapshot?.marketTradingAmount != null ? snapshot.marketTradingAmount / 1_000_000_000_000 : sectors.reduce((sum, sector) => sum + sector.turnover, 0)
  const totalAdvancers = sectors.reduce((sum, sector) => sum + sector.advancers, 0)
  const totalDecliners = sectors.reduce((sum, sector) => sum + sector.decliners, 0)
  const totalForeign = sectors.reduce((sum, sector) => sum + sector.foreign, 0)
  const totalInstitution = sectors.reduce((sum, sector) => sum + sector.institution, 0)

  return (
    <main className="terminal-shell" data-testid="moneyflow-dashboard">
      <section className={`data-status ${live ? 'live' : 'demo'}`}>
        <span>{live ? '● TOSS LIVE' : '● DEMO FALLBACK'}</span>
        <strong>{snapshot?.marketSession ?? '08:00~20:00 통합시장'}</strong>
        <em>{live && snapshot ? `업데이트 ${new Date(snapshot.updatedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })}` : 'Docker 백엔드 연결 전에는 예시 데이터가 표시됩니다.'}</em>
      </section>
      {apiError && <div className="api-error">{apiError}</div>}

      <section className="market-strip">
        <div><span>KOSPI</span><strong>{kospi?.lastPrice?.toLocaleString() ?? '3,287.41'}</strong><em className={(kospi?.changeRate ?? 1.14) >= 0 ? 'up' : 'down'}>{signed(kospi?.changeRate ?? 1.14, '%')}</em></div>
        <div><span>KOSDAQ</span><strong>{kosdaq?.lastPrice?.toLocaleString() ?? '921.08'}</strong><em className={(kosdaq?.changeRate ?? 0.62) >= 0 ? 'up' : 'down'}>{signed(kosdaq?.changeRate ?? 0.62, '%')}</em></div>
        <div><span>상승 / 하락</span><strong>{totalAdvancers} / {totalDecliners}</strong><em>현재 추적 종목 기준</em></div>
        <div><span>{live ? '통합 거래대금 TOP100' : '통합 거래대금'}</span><strong>{fmtAmountTrillion(totalAmount)}</strong><em>{live ? '토스 시장 전체 거래대금 랭킹 합계' : '데모 추적 섹터 합계'}</em></div>
        <div><span>외국인 / 기관</span><strong className={totalForeign >= 0 ? 'up' : 'down'}>{live ? fmtShares(totalForeign) : `${totalForeign > 0 ? '+' : ''}${totalForeign.toLocaleString()}억`}</strong><em className={totalInstitution >= 0 ? 'up' : 'down'}>{live ? fmtShares(totalInstitution) : `${totalInstitution > 0 ? '+' : ''}${totalInstitution.toLocaleString()}억`}</em></div>
      </section>

      <section className="dashboard-grid">
        <div className="panel heatmap-panel">
          <div className="panel-head"><div><p>MARKET HEATMAP</p><h2>한국 시장 전체 Heatmap</h2></div><span className={live ? 'live-badge' : 'demo-badge'}>{live ? 'TOSS LIVE' : 'DEMO SNAPSHOT'}</span></div>
          <div className="heatmap-grid">
            {ranked.map((sector) => {
              const score = sector.score
              const intensity = Math.min(0.82, 0.16 + Math.abs(score) / 100)
              return <button key={sector.name} className={`heat-tile ${score >= 0 ? 'positive' : 'negative'} ${sector.name === selectedSector.name ? 'active' : ''}`} style={{ ['--heat' as string]: intensity }} onClick={() => selectSector(sector.name)}><span>{sector.name}</span><strong>{signed(sector.change * demoFactor, '%')}</strong><small>Flow {signed(score)} · {fmtAmountTrillion(sector.turnover * demoFactor)}</small></button>
            })}
          </div>
        </div>

        <aside className="panel ranking-panel">
          <div className="panel-head"><div><p>MONEY FLOW</p><h2>Ranking</h2></div><span>{displayTime}</span></div>
          <div className="ranking-list">
            {ranked.map((sector, index) => <button key={sector.name} onClick={() => selectSector(sector.name)} className={sector.name === selectedSector.name ? 'active' : ''}><b>{String(index + 1).padStart(2, '0')}</b><span>{sector.name}<small>{fmtAmountTrillion(sector.turnover)} · {signed(sector.change, '%')}</small></span><strong className={sector.score >= 0 ? 'up' : 'down'}>{signed(sector.score)}</strong></button>)}
          </div>
        </aside>

        <section className="panel drill-panel">
          <div className="panel-head"><div><p>DRILL DOWN</p><h2>{selectedSector.name} → 세부테마 → 종목</h2></div><span>Score {signed(moneyFlowScore(selectedSector) * demoFactor)}</span></div>
          <div className="sector-metrics">
            <div><span>거래대금 가중 등락</span><strong className={selectedSector.change >= 0 ? 'up' : 'down'}>{signed(selectedSector.change * demoFactor, '%')}</strong></div>
            <div><span>통합 거래대금</span><strong>{fmtAmountTrillion(selectedSector.turnover * demoFactor)}</strong></div>
            <div><span>상승 비율</span><strong>{Math.round(selectedSector.advancers / Math.max(1, selectedSector.advancers + selectedSector.decliners) * 100)}%</strong></div>
            <div><span>외국인 순매수</span><strong className={selectedSector.foreign >= 0 ? 'up' : 'down'}>{live ? fmtShares(selectedSector.foreign) : `${selectedSector.foreign > 0 ? '+' : ''}${selectedSector.foreign.toLocaleString()}억`}</strong></div>
            <div><span>기관 순매수</span><strong className={selectedSector.institution >= 0 ? 'up' : 'down'}>{live ? fmtShares(selectedSector.institution) : `${selectedSector.institution > 0 ? '+' : ''}${selectedSector.institution.toLocaleString()}억`}</strong></div>
          </div>
          <div className="theme-tabs">{selectedSector.themes.map((theme) => <button key={theme.name} className={theme.name === selectedTheme.name ? 'active' : ''} onClick={() => setThemeName(theme.name)}>{theme.name}</button>)}</div>
          <div className="stock-table">
            <div className="table-row table-head"><span>종목</span><span>현재가</span><span>등락률</span><span>통합 거래대금</span><span>외국인</span><span>기관</span></div>
            {selectedTheme.stocks.map((stock) => <div className="table-row" key={stock.ticker}><span><b>{stock.name}</b><small>{stock.ticker} · {stock.market}</small></span><span>{stock.price != null ? `${stock.price.toLocaleString()}원` : '-'}</span><span className={stock.change >= 0 ? 'up' : 'down'}>{signed(stock.change * demoFactor, '%')}</span><span>{stock.turnoverEstimated ? '~' : ''}{fmtAmountTrillion(stock.turnover * demoFactor)}</span><span className={stock.foreign >= 0 ? 'up' : 'down'}>{live ? fmtShares(stock.foreign) : `${stock.foreign > 0 ? '+' : ''}${stock.foreign.toLocaleString()}억`}</span><span className={stock.institution >= 0 ? 'up' : 'down'}>{live ? fmtShares(stock.institution) : `${stock.institution > 0 ? '+' : ''}${stock.institution.toLocaleString()}억`}</span></div>)}
          </div>
        </section>

        <section className="panel timeline-panel">
          <div className="panel-head"><div><p>TIMELINE</p><h2>08:00 → 20:00 · KRX + NXT 통합 흐름</h2></div><strong data-testid="timeline-current">{displayTime}</strong></div>
          <input aria-label="시장 시간 재생" type="range" min="0" max="720" step="10" value={minute} onChange={(event) => setMinute(Number(event.target.value))} />
          <div className="time-labels"><span>08:00</span><span>10:00</span><span>12:00</span><span>14:00</span><span>16:00</span><span>18:00</span><span>20:00</span></div>
          <p className="formula-note">Money Flow Score = 거래대금 가중 등락 35% + 통합 거래대금 강도 20% + 상승종목 비율 20% + 외국인·기관 순매수 강도 25%. 실시간 모드의 거래대금은 토스 시장 전체 랭킹 값을 우선하며, 랭킹 밖 추적 종목은 OHLCV로 추정해 ~ 표시합니다.</p>
        </section>
      </section>
    </main>
  )
}
