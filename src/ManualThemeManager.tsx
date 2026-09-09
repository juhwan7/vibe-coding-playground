import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import './manualThemeManager.css'

type ThemeOption = {
  name: string
  builtIn: boolean
  usageCount: number
}

type ThemeAdminPayload = {
  ok?: boolean
  updatedAt?: string | null
  themes?: ThemeOption[]
  assignments?: Record<string, string[]>
  writeProtected?: boolean
  error?: string | null
  operation?: {
    created?: boolean
    name?: string
    merged?: boolean
  } | null
}

type RankingItem = {
  symbol?: string | null
  name?: string | null
  securityType?: string | null
}

type SnapshotPayload = {
  topRankings?: RankingItem[]
}

function validStockName(name: string | null | undefined, symbol: string | null | undefined) {
  const value = String(name ?? '').trim()
  const code = String(symbol ?? '').trim()
  if (!value || value === code || /^\d{6}$/.test(value)) return null
  return value
}

function displayUpdatedAt(value?: string | null) {
  if (!value) return '아직 저장된 변경 없음'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

async function readJson<T>(response: Response | null) {
  if (!response) return null
  return response.json().catch(() => null) as Promise<T | null>
}

export default function ManualThemeManager() {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [admin, setAdmin] = useState<ThemeAdminPayload | null>(null)
  const [rankings, setRankings] = useState<RankingItem[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState('')
  const [selectedThemes, setSelectedThemes] = useState<string[]>([])
  const [newThemeName, setNewThemeName] = useState('')
  const [adminToken, setAdminToken] = useState(() => window.localStorage.getItem('market-theme-admin-token') ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let currentHost: HTMLDivElement | null = null
    const syncHost = () => {
      const board = document.querySelector<HTMLElement>('.theme-flow-workspace .theme-strength-board')
      const anchor = board?.querySelector<HTMLElement>('.theme-method-strip')
      if (!board || !anchor) {
        if (currentHost?.isConnected) currentHost.remove()
        currentHost = null
        setHost(null)
        return
      }

      if (currentHost?.isConnected && currentHost.parentElement === board) return
      currentHost?.remove()
      const next = document.createElement('div')
      next.id = 'manual-theme-manager-host'
      board.insertBefore(next, anchor)
      currentHost = next
      setHost(next)
    }

    syncHost()
    const observer = new MutationObserver(syncHost)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      currentHost?.remove()
      setHost(null)
    }
  }, [])

  const loadAdmin = useCallback(async () => {
    const response = await fetch('/api/market/theme-admin', {
      headers: { Accept: 'application/json' },
    }).catch(() => null)
    const payload = await readJson<ThemeAdminPayload>(response)
    if (!response?.ok || !payload?.ok) {
      throw new Error(payload?.error ?? '테마 사전을 불러오지 못했습니다.')
    }
    setAdmin(payload)
    return payload
  }, [])

  const loadRankings = useCallback(async () => {
    const response = await fetch('/api/market/snapshot', {
      headers: { Accept: 'application/json' },
    }).catch(() => null)
    const payload = await readJson<SnapshotPayload>(response)
    const items = (payload?.topRankings ?? [])
      .filter((item) => /^\d{6}$/.test(String(item.symbol ?? '')))
      .filter((item) => !item.securityType || String(item.securityType).toUpperCase() === 'STOCK')
      .slice(0, 100)
    setRankings(items)
    setSelectedSymbol((current) => {
      if (current && items.some((item) => item.symbol === current)) return current
      return String(items[0]?.symbol ?? '')
    })
  }, [])

  useEffect(() => {
    if (!host) return
    let active = true
    const load = async () => {
      try {
        await Promise.all([loadAdmin(), loadRankings()])
        if (active) setError(null)
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError))
      }
    }
    void load()
    const timer = window.setInterval(() => {
      void loadRankings().catch(() => {})
    }, 10000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [host, loadAdmin, loadRankings])

  useEffect(() => {
    if (!selectedSymbol) {
      setSelectedThemes([])
      return
    }
    setSelectedThemes([...(admin?.assignments?.[selectedSymbol] ?? [])])
  }, [selectedSymbol, admin?.updatedAt, admin?.assignments])

  const selectedStock = useMemo(
    () => rankings.find((item) => item.symbol === selectedSymbol) ?? null,
    [rankings, selectedSymbol],
  )

  const postAction = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }
      if (adminToken.trim()) headers['X-Theme-Admin-Token'] = adminToken.trim()
      const response = await fetch('/api/market/theme-admin', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const payload = await readJson<ThemeAdminPayload>(response)
      if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? '테마 설정을 저장하지 못했습니다.')
      setAdmin(payload)
      return payload
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
      return null
    } finally {
      setBusy(false)
    }
  }

  const createTheme = async () => {
    const name = newThemeName.trim()
    if (!name) return
    const payload = await postAction({ action: 'create-theme', name })
    if (!payload) return
    const savedName = payload.operation?.name ?? name
    setNewThemeName('')
    setMessage(payload.operation?.created === false ? `이미 있는 테마 '${savedName}'입니다.` : `'${savedName}' 테마를 만들었습니다.`)
  }

  const renameTheme = async (theme: ThemeOption) => {
    const next = window.prompt(`'${theme.name}'의 새 이름을 입력하세요.\n기존 테마 이름을 입력하면 두 테마가 하나로 합쳐집니다.`, theme.name)
    if (next == null || next.trim() === theme.name) return
    const payload = await postAction({ action: 'rename-theme', fromName: theme.name, toName: next })
    if (!payload) return
    const target = payload.operation?.name ?? next.trim()
    setMessage(payload.operation?.merged ? `'${theme.name}'을 '${target}'에 합쳤습니다.` : `'${theme.name}'을 '${target}'으로 변경했습니다.`)
  }

  const deleteTheme = async (theme: ThemeOption) => {
    const usageText = theme.usageCount > 0 ? `\n현재 ${theme.usageCount}개 종목에서 사용 중이며 연결도 함께 해제됩니다.` : ''
    if (!window.confirm(`'${theme.name}' 테마를 삭제할까요?${usageText}`)) return
    const payload = await postAction({ action: 'delete-theme', name: theme.name })
    if (payload) setMessage(`'${theme.name}' 테마를 삭제했습니다.`)
  }

  const toggleTheme = (name: string) => {
    setSelectedThemes((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name])
  }

  const saveAssignment = async () => {
    if (!selectedSymbol) return
    if (!selectedThemes.length) {
      setError('하나 이상의 테마를 선택하거나 자동분류로 복귀를 눌러주세요.')
      return
    }
    const payload = await postAction({ action: 'assign-stock', symbol: selectedSymbol, themes: selectedThemes })
    if (payload) setMessage(`${validStockName(selectedStock?.name, selectedSymbol) ?? selectedSymbol} → ${selectedThemes.join(', ')} 등록 완료`)
  }

  const restoreAutomatic = async () => {
    if (!selectedSymbol) return
    const payload = await postAction({ action: 'assign-stock', symbol: selectedSymbol, themes: [] })
    if (payload) {
      setSelectedThemes([])
      setMessage(`${validStockName(selectedStock?.name, selectedSymbol) ?? selectedSymbol}을 자동 테마 분류로 되돌렸습니다.`)
    }
  }

  const saveAdminToken = (value: string) => {
    setAdminToken(value)
    if (value) window.localStorage.setItem('market-theme-admin-token', value)
    else window.localStorage.removeItem('market-theme-admin-token')
  }

  if (!host) return null

  const content = <section className="manual-theme-manager" data-testid="manual-theme-manager">
    <div className="manual-theme-manager-head">
      <div>
        <p>MANUAL THEME DICTIONARY</p>
        <h2>수동 테마 사전 <span>한 번 만든 이름을 계속 재사용</span></h2>
        <small>자유 입력은 이곳에서만 합니다. 아래 종목 등록에서는 기존 테마만 골라서 오타·중복 테마 생성을 막습니다.</small>
      </div>
      <div className="manual-theme-manager-status">
        <span>{admin?.themes?.length ?? 0}개 테마</span>
        <small>{displayUpdatedAt(admin?.updatedAt)}</small>
      </div>
    </div>

    <div className="manual-theme-create-row">
      <label htmlFor="manual-theme-name">새 테마</label>
      <input
        id="manual-theme-name"
        value={newThemeName}
        maxLength={32}
        placeholder="예: 대미투자"
        onChange={(event) => setNewThemeName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void createTheme()
          }
        }}
        disabled={busy}
      />
      <button type="button" onClick={() => void createTheme()} disabled={busy || !newThemeName.trim()}>+ 테마 추가</button>
      <span className="manual-theme-create-help">같은 이름은 중복 생성되지 않습니다.</span>
    </div>

    {admin?.writeProtected && <div className="manual-theme-token-row">
      <label htmlFor="manual-theme-token">관리 키</label>
      <input
        id="manual-theme-token"
        type="password"
        value={adminToken}
        autoComplete="off"
        placeholder="Pi에 설정한 THEME_ADMIN_WRITE_TOKEN"
        onChange={(event) => saveAdminToken(event.target.value)}
      />
      <small>이 브라우저에만 저장됩니다.</small>
    </div>}

    <div className="manual-theme-library" aria-label="테마 사전 목록">
      {(admin?.themes ?? []).map((theme) => <span className={`manual-theme-library-chip${theme.builtIn ? ' is-built-in' : ''}`} key={theme.name}>
        <b>{theme.name}</b>
        <small>{theme.usageCount}종목</small>
        {theme.builtIn
          ? <em>기본</em>
          : <span className="manual-theme-chip-actions">
              <button type="button" onClick={() => void renameTheme(theme)} disabled={busy} aria-label={`${theme.name} 이름 변경`}>수정</button>
              <button type="button" onClick={() => void deleteTheme(theme)} disabled={busy} aria-label={`${theme.name} 삭제`}>삭제</button>
            </span>}
      </span>)}
      {!admin?.themes?.length && <span className="manual-theme-empty">테마 사전 연결 중…</span>}
    </div>

    <div className="manual-theme-assignment">
      <div className="manual-theme-stock-picker">
        <label htmlFor="manual-theme-stock">종목 선택</label>
        <select id="manual-theme-stock" value={selectedSymbol} onChange={(event) => setSelectedSymbol(event.target.value)} disabled={busy || !rankings.length}>
          {rankings.map((item, index) => <option key={item.symbol ?? index} value={item.symbol ?? ''}>
            {index + 1}. {validStockName(item.name, item.symbol) ?? item.symbol} ({item.symbol})
          </option>)}
        </select>
        <small>{admin?.assignments?.[selectedSymbol]?.length ? '수동 지정 사용 중' : '현재 자동 분류 사용 중'}</small>
      </div>

      <div className="manual-theme-choice-area">
        <span className="manual-theme-choice-title">테마 선택 <small>복수 선택 가능</small></span>
        <div className="manual-theme-choice-list">
          {(admin?.themes ?? []).map((theme) => <label className={`manual-theme-choice${selectedThemes.includes(theme.name) ? ' is-selected' : ''}`} key={theme.name}>
            <input
              type="checkbox"
              checked={selectedThemes.includes(theme.name)}
              onChange={() => toggleTheme(theme.name)}
              disabled={busy || !selectedSymbol}
            />
            <span>{theme.name}</span>
          </label>)}
        </div>
      </div>

      <div className="manual-theme-actions">
        <button type="button" className="primary" onClick={() => void saveAssignment()} disabled={busy || !selectedSymbol || !selectedThemes.length}>선택 테마 등록</button>
        <button type="button" onClick={() => void restoreAutomatic()} disabled={busy || !selectedSymbol}>자동분류로 복귀</button>
        <small>저장 후 종목 라벨은 수초 내, 주도테마 5개 계산은 다음 테마 갱신에 반영됩니다.</small>
      </div>
    </div>

    {(message || error) && <div className={`manual-theme-feedback${error ? ' is-error' : ''}`} role="status">
      {error ?? message}
    </div>}
  </section>

  return createPortal(content, host)
}
