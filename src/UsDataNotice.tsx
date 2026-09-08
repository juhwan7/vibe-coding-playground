import { useEffect, useState } from 'react'
import './usDataNotice.css'

type Attempt = { type?: string | null; duration?: string | null; count?: number | null; error?: string | null }
type Payload = {
  ok?: boolean
  stage?: string
  rankingLabel?: string | null
  rankingIsMarketWide?: boolean
  rankingAttempts?: Attempt[]
  error?: string | null
  updatedAt?: string | null
}

function kstTime(value?: string | null) {
  if (!value) return '-'
  try {
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
  } catch {
    return '-'
  }
}

export default function UsDataNotice() {
  const [data, setData] = useState<Payload>({})

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const load = async () => {
      try {
        const response = await fetch('/api/market/us-theme-flow', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null)
        if (response) {
          const payload = await response.json().catch(() => null) as Payload | null
          if (payload) setData(payload)
        }
      } finally {
        timer = window.setTimeout(load, data.ok ? 60000 : 10000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [data.ok])

  const attempts = data.rankingAttempts ?? []
  const attemptText = attempts.map((item) => `${item.type ?? 'ranking'} ${item.duration ?? ''}: ${item.count ?? 0}종목${item.error ? ` · ${item.error}` : ''}`).join(' / ')
  const fallback = data.rankingIsMarketWide === false && Boolean(data.rankingLabel)

  return <section className={`us-data-notice ${data.ok ? 'connected' : 'waiting'} ${fallback ? 'fallback' : ''}`} data-testid="us-data-notice">
    <div>
      <strong>{data.ok ? '미국 데이터 기준' : '미국 데이터 연결 상태'}</strong>
      <span>{data.rankingLabel ?? (data.error ? `연결 오류: ${data.error}` : '거래대금 랭킹 응답 대기 중')}</span>
    </div>
    <div className="us-data-notice-meta">
      {fallback && <b>시장전체 랭킹 미집계 · 대체 랭킹</b>}
      {attemptText && !data.ok && <small>{attemptText}</small>}
      <time>KST {kstTime(data.updatedAt)}</time>
    </div>
  </section>
}
