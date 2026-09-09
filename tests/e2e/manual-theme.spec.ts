import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('국내 테마 화면에서 재사용 테마를 만들고 종목에 수동 지정할 수 있다', async ({ page }) => {
  const state = {
    updatedAt: null as string | null,
    themes: [
      { name: '원전', builtIn: true, usageCount: 0 },
      { name: '반도체', builtIn: true, usageCount: 0 },
    ],
    assignments: {} as Record<string, string[]>,
  }

  await page.route('**/api/market/theme-admin', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, ...state, writeProtected: false }),
      })
    }

    const body = request.postDataJSON() as { action?: string; name?: string; symbol?: string; themes?: string[] }
    if (body.action === 'create-theme' && body.name) {
      if (!state.themes.some((theme) => theme.name === body.name)) {
        state.themes.push({ name: body.name, builtIn: false, usageCount: 0 })
      }
      state.updatedAt = new Date().toISOString()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, ...state, writeProtected: false, operation: { created: true, name: body.name } }),
      })
    }

    if (body.action === 'assign-stock' && body.symbol && Array.isArray(body.themes)) {
      const previous = state.assignments[body.symbol] ?? []
      state.themes.forEach((theme) => {
        if (previous.includes(theme.name)) theme.usageCount = Math.max(0, theme.usageCount - 1)
        if (body.themes!.includes(theme.name)) theme.usageCount += 1
      })
      if (body.themes.length) state.assignments[body.symbol] = [...body.themes]
      else delete state.assignments[body.symbol]
      state.updatedAt = new Date().toISOString()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, ...state, writeProtected: false, operation: { symbol: body.symbol, themes: body.themes } }),
      })
    }

    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: '지원하지 않는 테스트 작업' }),
    })
  })

  await page.route('**/api/market/snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        updatedAt: '2026-09-09T06:20:00.000Z',
        topRankings: [
          { symbol: '034020', name: '두산에너빌리티', market: 'KOSPI', securityType: 'STOCK', lastPrice: 71000, changeRate: 4.2, tradingAmount: 1800000000000, tradingVolume: 1000 },
          { symbol: '005930', name: '삼성전자', market: 'KOSPI', securityType: 'STOCK', lastPrice: 72000, changeRate: 1.1, tradingAmount: 1500000000000, tradingVolume: 1000 },
        ],
        stocks: {},
        indices: {},
      }),
    })
  })

  await page.goto('/')
  const manager = page.getByTestId('manual-theme-manager')
  await expect(manager).toBeVisible()
  await expect(manager.getByRole('heading', { name: /수동 테마 사전/ })).toBeVisible()
  await expect(manager.getByText('원전', { exact: true }).first()).toBeVisible()
  await expect(manager.getByLabel('종목 선택')).toBeEnabled()

  await manager.getByLabel('새 테마').fill('대미투자')
  await manager.getByRole('button', { name: '+ 테마 추가' }).click()
  await expect(manager.getByText('대미투자', { exact: true }).first()).toBeVisible()

  await manager.getByLabel('종목 선택').selectOption('034020')
  await manager.getByText('원전', { exact: true }).last().click()
  // 새 테마는 생성 직후 선택 후보에 추가되므로 현재 종목에 함께 체크된 상태다.
  await manager.getByRole('button', { name: '선택 테마 등록' }).click()

  await expect(manager).toContainText('두산에너빌리티 → 대미투자, 원전 등록 완료')
  await expect(manager).toContainText('수동 지정 사용 중')

  await manager.getByRole('button', { name: '자동분류로 복귀' }).click()
  await expect(manager).toContainText('자동 테마 분류로 되돌렸습니다')
  await expect(manager).toContainText('현재 자동 분류 사용 중')
})
